const express = require("express");
const mongoose = require("mongoose");
const Queue = require("../models/Queue");
const Token = require("../models/Token");
const {
  TOKEN_STATUSES,
  canTransition,
  getAllowedNextStatuses,
  addQueuePositions
} = require("../utils/tokenHelpers");

const router = express.Router();
const QUEUE_FIELDS = "name serviceDescription averageServiceMinutes isActive";

function parseLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) return 200;
  return Math.min(limit, 500);
}

// Reserve the next token number atomically.
// $inc is a single MongoDB operation, so two simultaneous requests receive
// different numbers even when they arrive at the same moment.
async function reserveTokenNumber(queueId) {
  // Support queues created before the counter existed by aligning the counter
  // with the highest token number already stored for that queue.
  const latestToken = await Token.findOne({ queue: queueId })
    .sort({ tokenNumber: -1 })
    .select("tokenNumber")
    .lean();

  if (latestToken) {
    await Queue.updateOne(
      { _id: queueId },
      { $max: { lastTokenNumber: latestToken.tokenNumber } }
    );
  }

  return Queue.findOneAndUpdate(
    { _id: queueId, isActive: true },
    { $inc: { lastTokenNumber: 1 } },
    { new: true, runValidators: true }
  );
}

// GET /api/tokens?queueId=<id>&status=Waiting&limit=200
router.get("/", async (req, res, next) => {
  try {
    const filter = {};

    if (req.query.queueId !== undefined) {
      if (!mongoose.isValidObjectId(req.query.queueId)) {
        return res.status(400).json({ success: false, message: "Invalid queueId." });
      }
      filter.queue = req.query.queueId;
    }

    if (req.query.status !== undefined) {
      if (!TOKEN_STATUSES.includes(req.query.status)) {
        return res.status(400).json({
          success: false,
          message: `Status filter must be one of: ${TOKEN_STATUSES.join(", ")}.`
        });
      }
      filter.status = req.query.status;
    }

    const limit = parseLimit(req.query.limit);

    const tokens = await Token.find(filter)
      .populate("queue", QUEUE_FIELDS)
      .sort({ issuedAt: -1, tokenNumber: -1 })
      .limit(limit)
      .select("-__v");

    const data = await addQueuePositions(tokens);

    res.json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/tokens/:id - retrieve one token with position and wait estimate
router.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid token ID." });
    }

    const token = await Token.findById(req.params.id)
      .populate("queue", QUEUE_FIELDS)
      .select("-__v");

    if (!token) {
      return res.status(404).json({ success: false, message: "Token not found." });
    }

    const [data] = await addQueuePositions([token]);

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// POST /api/tokens - issue a token for an active queue
router.post("/", async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, message: "Request body must be a JSON object." });
    }

    const customerName = typeof req.body.customerName === "string" ? req.body.customerName.trim() : "";
    const customerContact =
      req.body.customerContact === undefined || req.body.customerContact === null
        ? ""
        : typeof req.body.customerContact === "string"
          ? req.body.customerContact.trim()
          : null;

    if (customerName.length < 2 || customerName.length > 80) {
      return res.status(400).json({
        success: false,
        message: "Customer name must contain 2 to 80 characters."
      });
    }

    if (customerContact === null || customerContact.length > 120) {
      return res.status(400).json({
        success: false,
        message: "Contact information must be text with at most 120 characters."
      });
    }

    if (!mongoose.isValidObjectId(req.body.queueId)) {
      return res.status(400).json({ success: false, message: "Select a valid queue." });
    }

    const existingQueue = await Queue.findById(req.body.queueId).select("isActive name");
    if (!existingQueue) {
      return res.status(404).json({ success: false, message: "Queue not found." });
    }
    if (!existingQueue.isActive) {
      return res.status(409).json({
        success: false,
        message: "This queue is inactive. Activate it before issuing tokens."
      });
    }

    const queue = await reserveTokenNumber(existingQueue._id);

    if (!queue) {
      return res.status(409).json({
        success: false,
        message: "The queue is no longer active. Token was not created."
      });
    }

    const token = await Token.create({
      tokenNumber: queue.lastTokenNumber,
      customerName,
      customerContact,
      queue: queue._id
    });

    const populatedToken = await token.populate("queue", QUEUE_FIELDS);
    const [data] = await addQueuePositions([populatedToken]);

    res.status(201).json({
      success: true,
      message: `Token #${data.tokenNumber} issued to ${data.customerName}.`,
      data
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/tokens/:id/status - move a token through the allowed status flow
router.patch("/:id/status", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid token ID." });
    }

    const nextStatus = req.body ? req.body.status : undefined;

    if (!TOKEN_STATUSES.includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${TOKEN_STATUSES.join(", ")}.`
      });
    }

    const token = await Token.findById(req.params.id);
    if (!token) {
      return res.status(404).json({ success: false, message: "Token not found." });
    }

    if (token.status === nextStatus) {
      const populated = await token.populate("queue", QUEUE_FIELDS);
      const [data] = await addQueuePositions([populated]);
      return res.json({
        success: true,
        message: `Token is already ${nextStatus}.`,
        data
      });
    }

    if (!canTransition(token.status, nextStatus)) {
      return res.status(409).json({
        success: false,
        code: "INVALID_STATUS_TRANSITION",
        message: `Cannot change status from ${token.status} to ${nextStatus}.`,
        currentStatus: token.status,
        allowedNextStatuses: getAllowedNextStatuses(token.status)
      });
    }

    token.status = nextStatus;

    if (nextStatus === "Serving") {
      token.servedAt = token.servedAt || new Date();
    }
    if (nextStatus === "Completed") {
      token.completedAt = new Date();
    }
    if (nextStatus === "Cancelled") {
      token.cancelledAt = new Date();
    }

    await token.save();

    const populated = await token.populate("queue", QUEUE_FIELDS);
    const [data] = await addQueuePositions([populated]);

    res.json({
      success: true,
      message: `Token #${token.tokenNumber} marked as ${nextStatus}.`,
      data
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tokens/:id
router.delete("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid token ID." });
    }

    const token = await Token.findByIdAndDelete(req.params.id);
    if (!token) {
      return res.status(404).json({ success: false, message: "Token not found." });
    }

    res.json({
      success: true,
      message: `Token #${token.tokenNumber} deleted.`,
      data: { deletedTokenId: String(token._id), tokenNumber: token.tokenNumber }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

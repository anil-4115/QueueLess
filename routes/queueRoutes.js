const express = require("express");
const mongoose = require("mongoose");
const Queue = require("../models/Queue");
const Token = require("../models/Token");

const router = express.Router();

function normalizeQueueInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }

  const data = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string") return { error: "Queue name must be text." };
    data.name = body.name.trim();
  }

  // serviceName is accepted for backwards compatibility with older versions.
  const description = body.serviceDescription !== undefined ? body.serviceDescription : body.serviceName;
  if (description !== undefined) {
    if (typeof description !== "string") return { error: "Service description must be text." };
    data.serviceDescription = description.trim();
  }

  if (body.averageServiceMinutes !== undefined) {
    const minutes = Number(body.averageServiceMinutes);
    if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
      return { error: "Average service time must be a whole number of minutes." };
    }
    data.averageServiceMinutes = minutes;
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") return { error: "isActive must be true or false." };
    data.isActive = body.isActive;
  }

  return { data };
}

async function getTokenCountsByQueue(queueIds) {
  if (queueIds.length === 0) return new Map();

  const objectIds = queueIds.map(id => new mongoose.Types.ObjectId(id));
  const grouped = await Token.aggregate([
    { $match: { queue: { $in: objectIds } } },
    {
      $group: {
        _id: { queue: "$queue", status: "$status" },
        count: { $sum: 1 }
      }
    }
  ]);

  const countsByQueue = new Map();

  for (const group of grouped) {
    const queueId = String(group._id.queue);
    const status = group._id.status;
    const current = countsByQueue.get(queueId) || {
      Waiting: 0,
      Serving: 0,
      Completed: 0,
      Cancelled: 0
    };
    current[status] = group.count;
    countsByQueue.set(queueId, current);
  }

  return countsByQueue;
}

function withTokenCounts(queue, countsByQueue) {
  const counts = countsByQueue.get(String(queue._id)) || {
    Waiting: 0,
    Serving: 0,
    Completed: 0,
    Cancelled: 0
  };

  return {
    ...queue,
    waitingCount: counts.Waiting,
    servingCount: counts.Serving,
    completedCount: counts.Completed,
    cancelledCount: counts.Cancelled,
    activeTokens: counts.Waiting + counts.Serving,
    totalTokens: counts.Waiting + counts.Serving + counts.Completed + counts.Cancelled,
    nextTokenNumber: (queue.lastTokenNumber || 0) + 1
  };
}

// GET /api/queues - list all queues with live token counts
router.get("/", async (req, res, next) => {
  try {
    const queues = await Queue.find().select("-__v").sort({ createdAt: -1 }).lean();
    const countsByQueue = await getTokenCountsByQueue(queues.map(queue => queue._id));

    res.json({
      success: true,
      count: queues.length,
      data: queues.map(queue => withTokenCounts(queue, countsByQueue))
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/queues - create a queue
router.post("/", async (req, res, next) => {
  try {
    const { data, error } = normalizeQueueInput(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    if (!data.name) {
      return res.status(400).json({ success: false, message: "Queue name is required." });
    }
    if (!data.serviceDescription) {
      return res.status(400).json({ success: false, message: "Service description is required." });
    }
    if (data.averageServiceMinutes === undefined) {
      return res.status(400).json({ success: false, message: "Average service time is required." });
    }

    const queue = await Queue.create(data);
    const queueObject = queue.toObject();

    res.status(201).json({
      success: true,
      message: "Queue created successfully.",
      data: withTokenCounts(queueObject, new Map())
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/queues/:id - queue details with counts
router.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid queue ID." });
    }

    const queue = await Queue.findById(req.params.id).select("-__v").lean();
    if (!queue) {
      return res.status(404).json({ success: false, message: "Queue not found." });
    }

    const countsByQueue = await getTokenCountsByQueue([queue._id]);

    res.json({
      success: true,
      data: withTokenCounts(queue, countsByQueue)
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/queues/:id - update queue details
router.put("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid queue ID." });
    }

    const { data, error } = normalizeQueueInput(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one field to update: name, serviceDescription, averageServiceMinutes or isActive."
      });
    }

    const queue = await Queue.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true
    }).select("-__v");

    if (!queue) {
      return res.status(404).json({ success: false, message: "Queue not found." });
    }

    const countsByQueue = await getTokenCountsByQueue([queue._id]);

    res.json({
      success: true,
      message: "Queue updated successfully.",
      data: withTokenCounts(queue.toObject(), countsByQueue)
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/queues/:id?cascade=true
// Policy: a queue that still has tokens is protected. The caller must explicitly
// confirm cascade deletion, which permanently removes all of the queue's tokens.
router.delete("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid queue ID." });
    }

    const queue = await Queue.findById(req.params.id);
    if (!queue) {
      return res.status(404).json({ success: false, message: "Queue not found." });
    }

    const tokenCount = await Token.countDocuments({ queue: queue._id });
    const cascade = req.query.cascade === "true";

    if (tokenCount > 0 && !cascade) {
      return res.status(409).json({
        success: false,
        code: "QUEUE_HAS_TOKENS",
        message: `This queue has ${tokenCount} token(s). Retry with ?cascade=true to delete the queue and all of its tokens.`,
        tokenCount
      });
    }

    let deletedTokens = 0;
    if (cascade) {
      const result = await Token.deleteMany({ queue: queue._id });
      deletedTokens = result.deletedCount || 0;
    }

    await Queue.findByIdAndDelete(queue._id);

    res.json({
      success: true,
      message: cascade
        ? `Queue deleted along with ${deletedTokens} token(s).`
        : "Queue deleted successfully.",
      data: { deletedQueueId: String(queue._id), deletedTokens }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

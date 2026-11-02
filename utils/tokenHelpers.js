const mongoose = require("mongoose");
const Token = require("../models/Token");

const TOKEN_STATUSES = Token.TOKEN_STATUSES;

// A token can only move forward through these states.
const ALLOWED_TRANSITIONS = {
  Waiting: ["Serving", "Cancelled"],
  Serving: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: []
};

function canTransition(currentStatus, nextStatus) {
  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  return allowed.includes(nextStatus);
}

function getAllowedNextStatuses(currentStatus) {
  return ALLOWED_TRANSITIONS[currentStatus] || [];
}

function toPlainToken(token) {
  return typeof token.toObject === "function" ? token.toObject() : { ...token };
}

function getQueueId(token) {
  const queue = token.queue;
  if (!queue) return "";
  if (typeof queue === "object") return String(queue._id || queue);
  return String(queue);
}

function getQueueAverageMinutes(token) {
  const queue = token.queue;
  if (!queue || typeof queue !== "object") return null;
  const minutes = queue.averageServiceMinutes;
  return typeof minutes === "number" ? minutes : null;
}

/**
 * Adds queuePosition, peopleAhead and estimatedWaitMinutes to token objects.
 *
 * Estimate assumes a single service point:
 *   estimatedWaitMinutes = (waiting tokens ahead + tokens currently Serving) * averageServiceMinutes
 * If a queue has several staff members, the real wait will be shorter.
 */
async function addQueuePositions(tokens) {
  const plainTokens = tokens.map(toPlainToken);
  if (plainTokens.length === 0) return plainTokens;

  const queueIds = [...new Set(plainTokens.map(getQueueId).filter(Boolean))];

  const [waitingTokens, servingCounts] = await Promise.all([
    Token.find({ queue: { $in: queueIds }, status: "Waiting" })
      .select("queue tokenNumber")
      .lean(),
    Token.aggregate([
      {
        $match: {
          queue: { $in: queueIds.map(id => new mongoose.Types.ObjectId(id)) },
          status: "Serving"
        }
      },
      { $group: { _id: "$queue", count: { $sum: 1 } } }
    ])
  ]);

  const waitingNumbersByQueue = new Map();
  for (const waiting of waitingTokens) {
    const key = String(waiting.queue);
    if (!waitingNumbersByQueue.has(key)) waitingNumbersByQueue.set(key, []);
    waitingNumbersByQueue.get(key).push(waiting.tokenNumber);
  }

  const servingByQueue = new Map(servingCounts.map(item => [String(item._id), item.count]));

  return plainTokens.map(token => {
    const key = getQueueId(token);
    const averageMinutes = getQueueAverageMinutes(token);

    if (token.status === "Waiting") {
      const numbers = waitingNumbersByQueue.get(key) || [];
      const peopleAhead = numbers.filter(number => number < token.tokenNumber).length;
      const currentlyServing = servingByQueue.get(key) || 0;

      token.peopleAhead = peopleAhead;
      token.queuePosition = peopleAhead + 1;
      token.estimatedWaitMinutes =
        averageMinutes === null ? null : (peopleAhead + currentlyServing) * averageMinutes;
    } else if (token.status === "Serving") {
      token.peopleAhead = 0;
      token.queuePosition = 0;
      token.estimatedWaitMinutes = 0;
    } else {
      token.peopleAhead = null;
      token.queuePosition = null;
      token.estimatedWaitMinutes = null;
    }

    return token;
  });
}

module.exports = {
  TOKEN_STATUSES,
  ALLOWED_TRANSITIONS,
  canTransition,
  getAllowedNextStatuses,
  addQueuePositions
};

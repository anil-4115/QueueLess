const express = require("express");
const Queue = require("../models/Queue");
const Token = require("../models/Token");
const { TOKEN_STATUSES, addQueuePositions } = require("../utils/tokenHelpers");

const router = express.Router();

// GET /api/dashboard/stats
router.get("/stats", async (req, res, next) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const recentLimit = Math.min(Math.max(Number(req.query.recentLimit) || 8, 1), 20);

    const [queueCount, activeQueueCount, statusGroups, completedToday, totalTokens, recentTokens] =
      await Promise.all([
        Queue.countDocuments(),
        Queue.countDocuments({ isActive: true }),
        Token.aggregate([
          { $group: { _id: "$status", count: { $sum: 1 } } }
        ]),
        Token.countDocuments({ status: "Completed", completedAt: { $gte: startOfToday } }),
        Token.countDocuments(),
        Token.find()
          .populate("queue", "name serviceDescription averageServiceMinutes isActive")
          .sort({ issuedAt: -1, tokenNumber: -1 })
          .limit(recentLimit)
          .select("-__v")
      ]);

    const statusCounts = {
      Waiting: 0,
      Serving: 0,
      Completed: 0,
      Cancelled: 0
    };

    for (const group of statusGroups) {
      if (TOKEN_STATUSES.includes(group._id)) {
        statusCounts[group._id] = group.count;
      }
    }

    const recent = await addQueuePositions(recentTokens);

    res.json({
      success: true,
      data: {
        totals: {
          queues: queueCount,
          activeQueues: activeQueueCount,
          waiting: statusCounts.Waiting,
          serving: statusCounts.Serving,
          completed: statusCounts.Completed,
          cancelled: statusCounts.Cancelled,
          totalTokens,
          completedToday
        },
        recentTokens: recent
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

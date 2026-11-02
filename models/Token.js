const mongoose = require("mongoose");

const TOKEN_STATUSES = ["Waiting", "Serving", "Completed", "Cancelled"];

const tokenSchema = new mongoose.Schema(
  {
    tokenNumber: {
      type: Number,
      required: [true, "Token number is required"],
      min: [1, "Token number must be at least 1"],
      validate: {
        validator: Number.isInteger,
        message: "Token number must be a whole number"
      }
    },
    customerName: {
      type: String,
      required: [true, "Customer name is required"],
      trim: true,
      minlength: [2, "Customer name must be at least 2 characters"],
      maxlength: [80, "Customer name cannot exceed 80 characters"]
    },
    customerContact: {
      type: String,
      trim: true,
      maxlength: [120, "Contact information cannot exceed 120 characters"],
      default: ""
    },
    queue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Queue",
      required: [true, "Queue is required"],
      index: true
    },
    status: {
      type: String,
      enum: {
        values: TOKEN_STATUSES,
        message: `Status must be one of: ${TOKEN_STATUSES.join(", ")}`
      },
      default: "Waiting",
      index: true
    },
    issuedAt: {
      type: Date,
      default: Date.now
    },
    servedAt: {
      type: Date,
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    },
    cancelledAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

// Database-level guarantee: no duplicate token number inside the same queue.
tokenSchema.index({ queue: 1, tokenNumber: 1 }, { unique: true });

// Helps calculate queue position and dashboard counts efficiently.
tokenSchema.index({ queue: 1, status: 1, tokenNumber: 1 });

module.exports = mongoose.model("Token", tokenSchema);
module.exports.TOKEN_STATUSES = TOKEN_STATUSES;

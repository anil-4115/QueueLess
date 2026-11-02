const mongoose = require("mongoose");

const queueSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Queue name is required"],
      trim: true,
      minlength: [2, "Queue name must be at least 2 characters"],
      maxlength: [80, "Queue name cannot exceed 80 characters"]
    },
    serviceDescription: {
      type: String,
      required: [true, "Service description is required"],
      trim: true,
      minlength: [3, "Service description must be at least 3 characters"],
      maxlength: [200, "Service description cannot exceed 200 characters"]
    },
    averageServiceMinutes: {
      type: Number,
      required: [true, "Average service time is required"],
      min: [1, "Average service time must be at least 1 minute"],
      max: [240, "Average service time cannot exceed 240 minutes"],
      validate: {
        validator: Number.isInteger,
        message: "Average service time must be a whole number of minutes"
      }
    },
    isActive: {
      type: Boolean,
      default: true
    },
    // The last token number reserved for this queue. It is increased atomically
    // with $inc so two customers cannot receive the same token number.
    lastTokenNumber: {
      type: Number,
      default: 0,
      min: [0, "lastTokenNumber cannot be negative"]
    }
  },
  { timestamps: true }
);

queueSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model("Queue", queueSchema);

import express from "express";
import Feedback from "../model/feedback.js";
import userAuth from "../middleware/auth.js";

const feedbackRouter = express.Router();
feedbackRouter.post("/user/submitFeedback", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { feedbackText } = req.body;
    if (!feedbackText || feedbackText.trim().length === 0) {
      return res.status(400).send({ error: "Feedback text is required" });
    }
    const newFeedback = new Feedback({
      UserId: userId,
      feedbackText: feedbackText.trim(),
    });
    await newFeedback.save();
    res.status(201).send({
      message: "Feedback submitted successfully",
      data: newFeedback,
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

feedbackRouter.get("/user/feedbacks", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const feedbacks = await Feedback.find({ UserId: userId }).sort({
      createdAt: -1,
    });
    if (!feedbacks || feedbacks.length === 0) {
      return res.status(404).send({ message: "No feedbacks found" });
    }
    res.status(200).send({
      message: "Feedbacks retrieved successfully",
      data: feedbacks,
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

/// list all feedbacks for admin
// feedbackRouter.get("/allFeedbacks", userAuth, async (req, res) => {
//   try {
//     const feedbacks = await Feedback.find().sort({ createdAt: -1 });
//     if (!feedbacks || feedbacks.length === 0) {
//       return res.status(404).send({ message: "No feedbacks found" });
//     }
//     res.status(200).send({
//       message: "All feedbacks retrieved successfully",
//       data: feedbacks,
//     });
//   } catch (error) {
//     res.status(500).send({ error: error.message });
//   }
// });

export default feedbackRouter;

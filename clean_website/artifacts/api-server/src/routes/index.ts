import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coursesRouter from "./courses";
import materialsRouter from "./materials";
import summariesRouter from "./summaries";
import flashcardsRouter from "./flashcards";
import questionsRouter from "./questions";
import examsRouter from "./exams";
import chatRouter from "./chat";
import dashboardRouter from "./dashboard";
import generateAllRouter from "./generate-all";
import recordingsRouter from "./recordings";
import { billingAuthRouter } from "./billing";
import contactRouter from "./contact";

const router: IRouter = Router();

router.use(healthRouter);
router.use(coursesRouter);
router.use(materialsRouter);
router.use(summariesRouter);
router.use(flashcardsRouter);
router.use(questionsRouter);
router.use(examsRouter);
router.use(chatRouter);
router.use(dashboardRouter);
router.use(generateAllRouter);
router.use(recordingsRouter);
router.use(billingAuthRouter);
router.use(contactRouter);

export default router;

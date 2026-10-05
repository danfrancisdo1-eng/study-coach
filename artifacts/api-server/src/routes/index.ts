import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coachRouter from "./coach";
import studyRouter from "./study";
import lecturesRouter from "./lectures";
import coursesRouter from "./courses";
import chatRouter from "./chat";

export { requireStudyAuth } from "./study";

const router: IRouter = Router();

router.use(healthRouter);
router.use(coachRouter);
router.use(studyRouter);
router.use(lecturesRouter);
router.use(coursesRouter);
router.use(chatRouter);

export default router;

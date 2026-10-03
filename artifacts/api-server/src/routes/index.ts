import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coachRouter from "./coach";
import studyRouter from "./study";

export { requireStudyAuth } from "./study";

const router: IRouter = Router();

router.use(healthRouter);
router.use(coachRouter);
router.use(studyRouter);

export default router;

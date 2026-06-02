import { Router, type IRouter } from "express";
import healthRouter from "./health";
import documentsRouter from "./documents";
import researchRouter from "./research";

const router: IRouter = Router();

router.use(healthRouter);
router.use(documentsRouter);
router.use(researchRouter);

export default router;

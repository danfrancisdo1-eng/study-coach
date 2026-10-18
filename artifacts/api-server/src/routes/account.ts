// Account deletion (D-046, App Store readiness): one request removes everything saved for
// the signed-in account, then the sign-in identity itself. Study state (courses, materials,
// memory sheet, review schedule), study sessions (sets, decks, answers), chat threads and
// lectures (transcripts) go in one transaction; then the Clerk user is deleted so the email
// is gone too. Lecture audio lives only on the phone and leaves with the app.
import { Router, type IRouter, type Request } from "express";
import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import { aiCostTable, aiUsageTable, db, entitlementsTable, homeChatsTable, lecturesTable, questionBankTable, studySessionsTable, studyStatesTable } from "@workspace/db";
import { requireStudyAuth } from "./study";

const router: IRouter = Router();
router.use("/study/account", requireStudyAuth);

function owner(req: Request): string {
  if (!req.studyOwnerId) throw new Error("Missing authenticated account");
  return req.studyOwnerId;
}

router.delete("/study/account", async (req, res): Promise<void> => {
  const ownerId = owner(req);
  const counts = await db.transaction(async (tx) => {
    const sessions = await tx.delete(studySessionsTable).where(eq(studySessionsTable.ownerId, ownerId)).returning({ id: studySessionsTable.id });
    const chats = await tx.delete(homeChatsTable).where(eq(homeChatsTable.ownerId, ownerId)).returning({ id: homeChatsTable.id });
    const lectures = await tx.delete(lecturesTable).where(eq(lecturesTable.ownerId, ownerId)).returning({ id: lecturesTable.id });
    const states = await tx.delete(studyStatesTable).where(eq(studyStatesTable.ownerId, ownerId)).returning({ id: studyStatesTable.id });
    // Plan status and daily counters (D-090). The purchase itself stays with Apple and RevenueCat.
    await tx.delete(entitlementsTable).where(eq(entitlementsTable.ownerId, ownerId));
    await tx.delete(aiUsageTable).where(eq(aiUsageTable.ownerId, ownerId));
    // The question bank and the daily AI cost (D-145).
    await tx.delete(questionBankTable).where(eq(questionBankTable.ownerId, ownerId));
    await tx.delete(aiCostTable).where(eq(aiCostTable.ownerId, ownerId));
    return { sessions: sessions.length, chats: chats.length, lectures: lectures.length, states: states.length };
  });
  // The sign-in identity. Tests run without a Clerk backend (SKIP_CLERK_USER_DELETE=1); never set in production.
  let identityDeleted = false;
  if (process.env.SKIP_CLERK_USER_DELETE === "1") {
    req.log.warn({ ownerId }, "SKIP_CLERK_USER_DELETE=1: the Clerk user was not deleted");
  } else {
    try {
      await clerkClient.users.deleteUser(ownerId);
      identityDeleted = true;
    } catch (error) {
      // The data is gone; the identity is not. Say so, so the client can tell the student and we can finish it by hand.
      req.log.error({ ownerId, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : "Unknown error" }, "Account deletion: Clerk user deletion failed");
    }
  }
  req.log.info({ ownerId, ...counts, identityDeleted }, "Account deleted");
  res.json({ deleted: true, identityDeleted, ...counts });
});

export default router;

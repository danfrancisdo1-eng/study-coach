import express, { type Express } from "express";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router, { requireStudyAuth } from "./routes";
import privacyRouter from "./routes/privacy";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

// Expo Go uses native networking, but its browser preview is a separate origin.
// Only this workspace's development Expo origin may send bearer-authenticated
// study requests from a browser. This does not authorize the request itself.
app.use("/api/study", (req, res, next) => {
  const origin = req.get("Origin");
  const developmentHost = process.env.REPLIT_DEV_DOMAIN?.replace(/^https?:\/\//, "").split(".")[0];
  if (process.env.NODE_ENV !== "development" || !origin || !developmentHost) {
    next();
    return;
  }
  let allowed = false;
  try {
    const parsed = new URL(origin);
    allowed = parsed.protocol === "https:"
      && parsed.hostname.split(".")[0] === developmentHost
      && /^[^.]+\.expo\.[a-z0-9-]+\.replit\.dev$/.test(parsed.hostname)
      && !parsed.port;
  } catch {
    // Invalid origins receive no CORS headers.
  }
  if (!allowed) {
    next();
    return;
  }
  res.vary("Origin");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Filename");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
app.use(
  "/api/study/materials/extract",
  requireStudyAuth,
);
app.use(
  "/api/study/materials/extract",
  (req, res, next) => {
    express.raw({
      type: [
        "application/octet-stream",
        "text/plain",
        "text/markdown",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "image/*",
      ],
      limit: "12mb",
    })(req, res, (error?: unknown) => {
      if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
        res.status(413).json({ error: "Uploaded material exceeds the 12 MB limit." });
        return;
      }
      if (error) {
        res.status(400).json({ error: "Could not read the uploaded material." });
        return;
      }
      next();
    });
  },
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
// The privacy policy is a public page, so it also answers at the root (the URL the app links to and App Store Connect asks for).
app.use(privacyRouter);

export default app;

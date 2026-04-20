const express = require("express");
const { loginController, meController, wechatOauthController } = require("../controllers/auth-controller");
const { createTeamController, listTeamsController, updateTeamController } = require("../controllers/team-controller");
const { createMemberController, linkMemberToTeamController, listMembersController } = require("../controllers/member-controller");
const { createRecordController } = require("../controllers/record-controller");
const { getSettlementController, settleController } = require("../controllers/settlement-controller");
const { monthStatsController, yearStatsController } = require("../controllers/stats-controller");
const { authenticate, authorize, ensureTeamAccess } = require("../middleware/auth");

const apiRouter = express.Router();

apiRouter.post("/login", loginController);
apiRouter.post("/auth/wx-oauth", wechatOauthController);
apiRouter.get("/me", authenticate, meController);

apiRouter.get("/teams", authenticate, authorize("admin", "team_user", "user"), listTeamsController);
apiRouter.post("/teams", authenticate, authorize("admin"), createTeamController);
apiRouter.put("/teams/:id", authenticate, authorize("admin"), updateTeamController);

apiRouter.get("/members", authenticate, ensureTeamAccess, listMembersController);
apiRouter.post("/members", authenticate, ensureTeamAccess, createMemberController);
apiRouter.post("/members/link", authenticate, ensureTeamAccess, linkMemberToTeamController);

apiRouter.post("/records", authenticate, ensureTeamAccess, createRecordController);

apiRouter.post("/settle", authenticate, ensureTeamAccess, settleController);
apiRouter.get("/settlement", authenticate, ensureTeamAccess, getSettlementController);

apiRouter.get("/stats/year", authenticate, authorize("admin"), yearStatsController);
apiRouter.get("/stats/month", authenticate, authorize("admin"), monthStatsController);

module.exports = { apiRouter };

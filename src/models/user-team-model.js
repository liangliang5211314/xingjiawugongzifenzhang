const { db } = require("../config/database");

function getAccessibleTeamIdsForUser(user) {
  if (user.role === "admin") {
    return null;
  }

  const rows = db
    .prepare("SELECT team_id FROM user_teams WHERE user_id = ? ORDER BY team_id ASC")
    .all(user.id);
  const teamIds = rows.map((row) => Number(row.team_id));

  if (user.team_id && !teamIds.includes(Number(user.team_id))) {
    teamIds.push(Number(user.team_id));
  }

  return teamIds;
}

module.exports = { getAccessibleTeamIdsForUser };

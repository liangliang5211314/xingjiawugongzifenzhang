const { getProfile, login } = require("../services/auth-service");

function loginController(req, res, next) {
  try {
    const result = login(req.body.username, req.body.password);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

function meController(req, res, next) {
  try {
    res.json(getProfile(req.user));
  } catch (error) {
    next(error);
  }
}

module.exports = { loginController, meController };

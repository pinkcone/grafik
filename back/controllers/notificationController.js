const {
  getJobsForUser,
  getJob,
  markJobRead,
  markAllRead,
} = require('../utils/autoFillJobStore');

exports.listNotifications = (req, res) => {
  const notifications = getJobsForUser(req.user.id);
  return res.json({ notifications });
};

exports.getNotification = (req, res) => {
  const notification = getJob(req.user.id, req.params.id);
  if (!notification) {
    return res.status(404).json({ message: 'Powiadomienie nie znalezione.' });
  }
  return res.json({ notification });
};

exports.markNotificationRead = (req, res) => {
  markJobRead(req.user.id, req.params.id);
  return res.json({ ok: true });
};

exports.markAllNotificationsRead = (req, res) => {
  markAllRead(req.user.id);
  return res.json({ ok: true });
};

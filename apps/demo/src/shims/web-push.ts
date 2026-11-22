// Web Push needs a server holding VAPID keys; the browser demo shows in-app notifications only.
export default {
  setVapidDetails() {},
  async sendNotification() {
    throw new Error('Web Push is not available in the browser demo');
  },
};

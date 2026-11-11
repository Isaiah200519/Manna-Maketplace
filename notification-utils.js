import { isAdminOnlyEmail } from './auth.js';

function getStoredRole(profile = {}) {
  const role = String(profile.role || profile.userRole || '').toLowerCase();
  if (role === 'delivery') return 'delivery_person';
  if (role) return role;
  if (profile.isAdmin || isAdminOnlyEmail(profile.email)) return 'admin';
  return '';
}

export async function createRoleNotification(db, recipientUid, recipientRole, notification) {
  if (!db || !recipientUid) return null;

  const recipientSnapshot = await db.collection('users').doc(recipientUid).get();
  if (!recipientSnapshot.exists) {
    console.warn('[Manna Marketplace] Notification skipped because its recipient profile was not found.', recipientUid);
    return null;
  }

  const storedRole = getStoredRole(recipientSnapshot.data());
  if (!['admin', 'seller', 'customer', 'delivery_person'].includes(storedRole)
      || (recipientRole && storedRole !== recipientRole)) {
    console.warn('[Manna Marketplace] Notification skipped because recipient role did not match.', {
      recipientUid,
      expectedRole: recipientRole || 'a supported marketplace role',
      storedRole
    });
    return null;
  }

  return db.collection('notifications').add({
    ...notification,
    recipientUid,
    recipientRole: storedRole,
    read: false,
    isDeleted: false,
    createdAt: notification.createdAt || new Date()
  });
}
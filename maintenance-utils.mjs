export function getMaintenanceExpiryMs(value) {
    if (value == null || value === '') return null;
    if (typeof value?.toMillis === 'function') {
        const timestamp = value.toMillis();
        return Number.isFinite(timestamp) ? timestamp : null;
    }

    const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function isMaintenanceActive(settings = {}, now = Date.now()) {
    if (settings.maintenanceMode !== true) return false;
    const expiresAt = getMaintenanceExpiryMs(settings.maintenanceUntil);
    return expiresAt === null || expiresAt > now;
}

export function formatMaintenanceCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const time = [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
    return days ? `${days}d ${time}` : time;
}

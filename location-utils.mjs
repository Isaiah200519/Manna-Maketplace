const EARTH_RADIUS_KM = 6371.0088;
const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

let leafletPromise = null;

export function normalizeCoordinates(value) {
    if (!value || typeof value !== 'object') return null;
    const rawLatitude = value.latitude ?? value.lat;
    const rawLongitude = value.longitude ?? value.lng;
    if (rawLatitude === null || rawLongitude === null
        || String(rawLatitude).trim() === '' || String(rawLongitude).trim() === '') return null;
    const latitude = Number(rawLatitude);
    const longitude = Number(rawLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
        || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return null;
    }
    return { latitude, longitude };
}

export function distanceInKilometers(first, second) {
    const origin = normalizeCoordinates(first);
    const destination = normalizeCoordinates(second);
    if (!origin || !destination) return null;

    const toRadians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = toRadians(destination.latitude - origin.latitude);
    const longitudeDelta = toRadians(destination.longitude - origin.longitude);
    const originLatitude = toRadians(origin.latitude);
    const destinationLatitude = toRadians(destination.latitude);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function calculateDistanceDeliveryFee(first, second, ratePerKilometer) {
    if (ratePerKilometer === null || ratePerKilometer === undefined || String(ratePerKilometer).trim() === '') return null;
    const rate = Number(ratePerKilometer);
    const distance = distanceInKilometers(first, second);
    if (distance === null || !Number.isFinite(rate) || rate < 0) return null;
    return Math.round(distance * rate * 100) / 100;
}

export function formatDistance(kilometers) {
    if (!Number.isFinite(kilometers) || kilometers < 0) return 'Distance unavailable';
    if (kilometers < 1) return `${Math.round(kilometers * 1000)} m`;
    return `${kilometers.toFixed(kilometers < 100 ? 1 : 0)} km`;
}

export function getMapsDirectionsUrl(origin, destination) {
    const start = normalizeCoordinates(origin);
    const end = normalizeCoordinates(destination);
    if (!start || !end) return '';
    const params = new URLSearchParams({
        api: '1',
        origin: `${start.latitude},${start.longitude}`,
        destination: `${end.latitude},${end.longitude}`,
        travelmode: 'driving'
    });
    return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function getMapsLocationUrl(coordinates) {
    const point = normalizeCoordinates(coordinates);
    if (!point) return '';
    const params = new URLSearchParams({
        api: '1',
        query: `${point.latitude},${point.longitude}`
    });
    return `https://www.google.com/maps/search/?${params.toString()}`;
}

export function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;

    leafletPromise = new Promise((resolve, reject) => {
        let stylesheet = document.querySelector(`link[href="${LEAFLET_CSS_URL}"]`);
        let stylesheetLoaded = Boolean(stylesheet?.sheet);
        if (!stylesheet) {
            stylesheet = document.createElement('link');
            stylesheet.rel = 'stylesheet';
            stylesheet.href = LEAFLET_CSS_URL;
            stylesheet.crossOrigin = 'anonymous';
            document.head.appendChild(stylesheet);
        }

        let script = document.querySelector(`script[src="${LEAFLET_JS_URL}"]`);
        let scriptLoaded = Boolean(window.L);
        if (!script && !window.L) {
            script = document.createElement('script');
            script.src = LEAFLET_JS_URL;
            script.crossOrigin = 'anonymous';
            document.head.appendChild(script);
        }

        const checkLoaded = () => {
            if (stylesheetLoaded && scriptLoaded && window.L) resolve(window.L);
        };
        stylesheet.addEventListener('load', () => {
            stylesheetLoaded = true;
            checkLoaded();
        }, { once: true });
        stylesheet.addEventListener('error', () => reject(new Error('Map styles failed to load.')), { once: true });
        if (window.L) {
            scriptLoaded = true;
            checkLoaded();
        } else {
            script.addEventListener('load', () => {
                scriptLoaded = true;
                checkLoaded();
            }, { once: true });
            script.addEventListener('error', () => reject(new Error('Map controls failed to load.')), { once: true });
        }
    }).catch((error) => {
        leafletPromise = null;
        throw error;
    });
    return leafletPromise;
}

export function createLocationMap(container, locations) {
    if (!window.L || !container) throw new Error('The map is not ready.');
    const points = locations
        .map((location) => ({ ...location, coordinates: normalizeCoordinates(location) }))
        .filter((location) => location.coordinates);
    if (!points.length) throw new Error('No valid coordinates are available for this map.');

    const map = window.L.map(container, { scrollWheelZoom: false });
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    const latLngs = points.map(({ coordinates }) => [coordinates.latitude, coordinates.longitude]);
    points.forEach((point) => {
        window.L.marker([point.coordinates.latitude, point.coordinates.longitude])
            .addTo(map)
            .bindTooltip(point.label, { direction: 'top', offset: [0, -8] });
    });
    if (latLngs.length > 1) {
        window.L.polyline(latLngs, { color: '#f97316', weight: 4, opacity: 0.8, dashArray: '8 6' }).addTo(map);
        map.fitBounds(latLngs, { padding: [28, 28], maxZoom: 15 });
    } else {
        map.setView(latLngs[0], 15);
    }
    window.setTimeout(() => map.invalidateSize(), 0);
    return map;
}

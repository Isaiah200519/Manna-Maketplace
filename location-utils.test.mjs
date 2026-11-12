import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDistanceDeliveryFee, distanceInKilometers, formatDistance, getMapsDirectionsUrl, getMapsLocationUrl, normalizeCoordinates } from './location-utils.mjs';

test('normalizes valid coordinates including zero and rejects invalid points', () => {
    assert.deepEqual(normalizeCoordinates({ lat: 0, lng: 0 }), { latitude: 0, longitude: 0 });
    assert.deepEqual(normalizeCoordinates({ latitude: 6.3, longitude: -10.8 }), { latitude: 6.3, longitude: -10.8 });
    assert.equal(normalizeCoordinates({ latitude: 91, longitude: 0 }), null);
    assert.equal(normalizeCoordinates({ latitude: null, longitude: null }), null);
});

test('calculates straight-line distance and formats results', () => {
    const distance = distanceInKilometers({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    assert.ok(Math.abs(distance - 111.195) < 0.02);
    assert.equal(distanceInKilometers({ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 }), 0);
    assert.equal(distanceInKilometers(null, { latitude: 0, longitude: 0 }), null);
    assert.equal(formatDistance(0.45), '450 m');
    assert.equal(formatDistance(3.24), '3.2 km');
    assert.equal(formatDistance(null), 'Distance unavailable');
});

test('calculates distance delivery fees from warehouse and customer coordinates', () => {
    const oneDegree = { latitude: 0, longitude: 0 };
    const nextDegree = { latitude: 1, longitude: 0 };
    assert.equal(calculateDistanceDeliveryFee(oneDegree, nextDegree, 10), 1111.95);
    assert.equal(calculateDistanceDeliveryFee(oneDegree, oneDegree, 10), 0);
    assert.equal(calculateDistanceDeliveryFee(oneDegree, nextDegree, 0), 0);
    assert.equal(calculateDistanceDeliveryFee(oneDegree, nextDegree, null), null);
    assert.equal(calculateDistanceDeliveryFee(oneDegree, nextDegree, ''), null);
    assert.equal(calculateDistanceDeliveryFee(null, nextDegree, 10), null);
    assert.equal(calculateDistanceDeliveryFee(oneDegree, nextDegree, -1), null);
});

test('creates a Google Maps route URL only for valid endpoints', () => {
    const url = new URL(getMapsDirectionsUrl({ latitude: 6.3, longitude: -10.8 }, { latitude: 6.31, longitude: -10.79 }));
    assert.equal(url.hostname, 'www.google.com');
    assert.equal(url.searchParams.get('origin'), '6.3,-10.8');
    assert.equal(url.searchParams.get('destination'), '6.31,-10.79');
    assert.equal(url.searchParams.get('travelmode'), 'driving');
    assert.equal(getMapsDirectionsUrl(null, { latitude: 0, longitude: 0 }), '');
});

test('creates a Google Maps location URL only for valid coordinates', () => {
    const url = new URL(getMapsLocationUrl({ latitude: 6.3, longitude: -10.8 }));
    assert.equal(url.hostname, 'www.google.com');
    assert.equal(url.searchParams.get('query'), '6.3,-10.8');
    assert.equal(getMapsLocationUrl(null), '');
});

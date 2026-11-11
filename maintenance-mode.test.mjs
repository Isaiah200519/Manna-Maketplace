import assert from 'node:assert/strict';
import test from 'node:test';
import { watchMaintenanceMode } from './maintenance-mode.js';
import { formatMaintenanceCountdown, getMaintenanceExpiryMs, isMaintenanceActive } from './maintenance-utils.mjs';

class MockElement {
    constructor(tagName, documentRef) {
        this.tagName = tagName;
        this.documentRef = documentRef;
        this.children = [];
        this.attributes = {};
        this.inert = false;
        this.hidden = false;
        this.isConnected = false;
        this.style = {};
    }

    appendChild(child) {
        child.parent = this;
        child.isConnected = this.isConnected;
        this.children.push(child);
        return child;
    }

    append(...children) {
        children.forEach((child) => this.appendChild(child));
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    focus() {
        this.documentRef.activeElement = this;
    }

    remove() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter((child) => child !== this);
        this.isConnected = false;
    }
}

function createDocumentMock() {
    const documentRef = {
        activeElement: null,
        createElement(tagName) {
            return new MockElement(tagName, documentRef);
        },
        getElementById(id) {
            const visit = (element) => {
                if (element.id === id) return element;
                for (const child of element.children) {
                    const match = visit(child);
                    if (match) return match;
                }
                return null;
            };
            return visit(this.body);
        }
    };
    documentRef.body = new MockElement('body', documentRef);
    documentRef.body.isConnected = true;
    documentRef.appShell = documentRef.body.appendChild(new MockElement('div', documentRef));
    documentRef.appShell.id = 'appShell';
    return documentRef;
}

test('maintenance listener blocks all page content and restores it when maintenance ends', () => {
    const documentRef = createDocumentMock();
    let onSnapshot;
    let unsubscribed = false;
    const db = {
        collection(name) {
            assert.equal(name, 'settings');
            return {
                doc(id) {
                    assert.equal(id, 'platform');
                    return {
                        onSnapshot(callback) {
                            onSnapshot = callback;
                            return () => { unsubscribed = true; };
                        }
                    };
                }
            };
        }
    };

    const stopWatching = watchMaintenanceMode(db, documentRef);
    onSnapshot({ exists: true, data: () => ({ maintenanceMode: true }) });

    const screen = documentRef.getElementById('maintenanceScreen');
    assert.ok(screen);
    assert.equal(screen.hidden, false);
    assert.equal(documentRef.appShell.inert, true);
    assert.equal(documentRef.activeElement.id, 'maintenanceTitle');
    assert.equal(screen.children[0].children[3].textContent, 'We’re making improvements to Manna Marketplace. The marketplace is temporarily paused, and your account information remains safe. Please check back shortly.');
    assert.equal(documentRef.getElementById('maintenanceTitle').textContent, 'We’ll be back soon');
    assert.equal(screen.children[0].children.some((element) => element.tagName === 'a'), false);

    onSnapshot({ exists: true, data: () => ({ maintenanceMode: false }) });
    assert.equal(screen.hidden, true);
    assert.equal(documentRef.appShell.inert, false);

    stopWatching();
    assert.equal(unsubscribed, true);
    assert.equal(documentRef.getElementById('maintenanceScreen'), null);
});

test('maintenance automatically ends at its expiry and shows a live countdown', () => {
    const documentRef = createDocumentMock();
    let onSnapshot;
    let onTick;
    let clearedTimer = false;
    let now = 1000;
    const db = {
        collection(name) {
            assert.equal(name, 'settings');
            return {
                doc(id) {
                    assert.equal(id, 'platform');
                    return {
                        onSnapshot(callback) {
                            onSnapshot = callback;
                            return () => {};
                        }
                    };
                }
            };
        }
    };

    watchMaintenanceMode(db, documentRef, {
        now: () => now,
        setInterval(callback) {
            onTick = callback;
            return 1;
        },
        clearInterval(timerId) {
            assert.equal(timerId, 1);
            clearedTimer = true;
        }
    });
    onSnapshot({
        exists: true,
        data: () => ({ maintenanceMode: true, maintenanceUntil: new Date(6500).toISOString() })
    });

    const screen = documentRef.getElementById('maintenanceScreen');
    const countdown = documentRef.getElementById('maintenanceCountdown');
    assert.equal(screen.hidden, false);
    assert.equal(countdown.hidden, false);
    assert.equal(countdown.textContent, 'Estimated time remaining: 00:00:06');

    now = 6500;
    onTick();
    assert.equal(screen.hidden, true);
    assert.equal(documentRef.appShell.inert, false);
    assert.equal(clearedTimer, true);
});

test('maintenance expiry helpers support manual mode and timestamp values', () => {
    const now = 1000;
    assert.equal(isMaintenanceActive({ maintenanceMode: true }, now), true);
    assert.equal(isMaintenanceActive({ maintenanceMode: false, maintenanceUntil: 5000 }, now), false);
    assert.equal(isMaintenanceActive({ maintenanceMode: true, maintenanceUntil: 5000 }, now), true);
    assert.equal(isMaintenanceActive({ maintenanceMode: true, maintenanceUntil: 500 }, now), false);
    assert.equal(getMaintenanceExpiryMs({ toMillis: () => 5000 }), 5000);
    assert.equal(formatMaintenanceCountdown(90061 * 1000), '1d 01:01:01');
});

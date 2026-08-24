import { firebaseServices } from './firebase-config.js';

const DATABASE_KEY = 'manna-local-database';
const SESSION_KEY = 'manna-local-session';
const listeners = new Map();
let database = readDatabase();

function readDatabase() {
    try {
        const value = JSON.parse(localStorage.getItem(DATABASE_KEY));
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function persistDatabase() {
    localStorage.setItem(DATABASE_KEY, JSON.stringify(database));
    window.dispatchEvent(new CustomEvent('manna-storage-change'));
}

function pathKey(path) {
    return path.join('/');
}

function collectionData(path) {
    const key = pathKey(path);
    if (!database[key] || typeof database[key] !== 'object') database[key] = {};
    return database[key];
}

function notify(path) {
    const key = pathKey(path);
    listeners.get(key)?.forEach((listener) => listener());
}

function matchesFilters(data, filters) {
    return filters.every(({ field, operator, value }) => {
        const actual = data?.[field];
        if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(value);
        if (operator === '!=') return actual !== value;
        return actual === value;
    });
}

function sortDocuments(documents, order) {
    if (!order) return documents;
    const [field, direction = 'asc'] = order;
    return documents.sort((left, right) => {
        const a = left.data()?.[field];
        const b = right.data()?.[field];
        const result = a === b ? 0 : a > b ? 1 : -1;
        return direction === 'desc' ? -result : result;
    });
}

class DocumentSnapshot {
    constructor(id, value) {
        this.id = id;
        this._value = value;
        this.exists = value !== undefined;
    }

    data() {
        return clone(this._value);
    }
}

class QuerySnapshot {
    constructor(docs) {
        this.docs = docs;
        this.empty = docs.length === 0;
        this.size = docs.length;
    }
}

class DocumentReference {
    constructor(path, id) {
        this.path = path;
        this.id = id;
    }

    get value() {
        return collectionData(this.path)[this.id];
    }

    async get() {
        return new DocumentSnapshot(this.id, this.value);
    }

    onSnapshot(callback) {
        const notifySnapshot = () => callback(new DocumentSnapshot(this.id, this.value));
        addListener(this.path, notifySnapshot);
        notifySnapshot();
        return () => removeListener(this.path, notifySnapshot);
    }

    collection(name) {
        return new CollectionReference([...this.path, this.id, name]);
    }

    async set(value, options = {}) {
        const current = this.value || {};
        collectionData(this.path)[this.id] = options.merge ? { ...current, ...clone(value) } : clone(value);
        persistDatabase();
        notify(this.path);
        return this;
    }

    async update(value) {
        if (!this.value) throw new Error(`Document ${this.id} does not exist`);
        return this.set(value, { merge: true });
    }

    async delete() {
        delete collectionData(this.path)[this.id];
        persistDatabase();
        notify(this.path);
    }
}

class CollectionReference {
    constructor(path, filters = [], order = null, maxResults = null) {
        this.path = path;
        this.filters = filters;
        this.order = order;
        this.maxResults = maxResults;
    }

    doc(id = createId()) {
        return new DocumentReference(this.path, id);
    }

    where(field, operator, value) {
        return new CollectionReference(this.path, [...this.filters, { field, operator, value }], this.order, this.maxResults);
    }

    orderBy(field, direction = 'asc') {
        return new CollectionReference(this.path, this.filters, [field, direction], this.maxResults);
    }

    limit(count) {
        return new CollectionReference(this.path, this.filters, this.order, count);
    }

    snapshot() {
        let documents = Object.entries(collectionData(this.path))
            .filter(([, value]) => matchesFilters(value, this.filters))
            .map(([id, value]) => new DocumentSnapshot(id, value));
        documents = sortDocuments(documents, this.order);
        return new QuerySnapshot(this.maxResults === null ? documents : documents.slice(0, this.maxResults));
    }

    async get() {
        return this.snapshot();
    }

    onSnapshot(callback) {
        const notifySnapshot = () => callback(this.snapshot());
        addListener(this.path, notifySnapshot);
        notifySnapshot();
        return () => removeListener(this.path, notifySnapshot);
    }

    async add(value) {
        const reference = this.doc();
        await reference.set(value);
        return reference;
    }
}

function addListener(path, callback) {
    const key = pathKey(path);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(callback);
}

function removeListener(path, callback) {
    listeners.get(pathKey(path))?.delete(callback);
}

function createId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const db = {
    collection(name) {
        return new CollectionReference([name]);
    },
    batch() {
        const operations = [];
        return {
            set(reference, value, options) {
                operations.push(() => reference.set(value, options));
            },
            async commit() {
                for (const operation of operations) await operation();
            }
        };
    },
    async runTransaction(callback) {
        const transaction = {
            get: (reference) => reference.get(),
            set: (reference, value, options) => reference.set(value, options),
            update: (reference, value) => reference.update(value)
        };
        return callback(transaction);
    }
};

function createUserRecord(email, password, profile = {}) {
    const uid = createId();
    return { uid, email, password, ...profile, createdAt: new Date(), updatedAt: new Date() };
}

function readSession() {
    return localStorage.getItem(SESSION_KEY);
}

function userForSession() {
    const uid = readSession();
    return uid ? db.collection('users').doc(uid).value : null;
}

function publicUser(record) {
    if (!record) return null;
    return {
        ...record,
        providerData: [{ providerId: 'password' }],
        updateProfile: async ({ displayName, photoURL }) => {
            await db.collection('users').doc(record.uid).set({ displayName, photoURL, updatedAt: new Date() }, { merge: true });
        }
    };
}

function createAuth() {
    const subscribers = new Set();
    const notifyAuth = () => subscribers.forEach((callback) => callback(publicUser(userForSession())));
    return {
        get currentUser() {
            return publicUser(userForSession());
        },
        onAuthStateChanged(callback) {
            subscribers.add(callback);
            queueMicrotask(() => callback(publicUser(userForSession())));
            return () => subscribers.delete(callback);
        },
        async signInWithEmailAndPassword(email, password) {
            const record = db.collection('users').snapshot().docs.map((doc) => doc.data()).find((user) => user.email?.toLowerCase() === email.toLowerCase() && user.password === password);
            if (!record) throw new Error('Invalid email or password.');
            localStorage.setItem(SESSION_KEY, record.uid);
            notifyAuth();
            return { user: publicUser(record) };
        },
        async createUserWithEmailAndPassword(email, password) {
            const exists = db.collection('users').snapshot().docs.some((doc) => doc.data()?.email?.toLowerCase() === email.toLowerCase());
            if (exists) throw new Error('An account with this email already exists.');
            const record = createUserRecord(email, password, { role: 'customer' });
            await db.collection('users').doc(record.uid).set(record);
            localStorage.setItem(SESSION_KEY, record.uid);
            notifyAuth();
            return { user: publicUser(record) };
        },
        async signOut() {
            localStorage.removeItem(SESSION_KEY);
            notifyAuth();
        },
        async sendPasswordResetEmail() {
            return true;
        },
        async setPersistence() {
            return true;
        }
    };
}

const auth = createAuth();

let activeDb = db;
let activeAuth = auth;

export function initStorage() {
    if (!firebaseServices?.db || !firebaseServices?.auth) {
        throw new Error('Firebase is unavailable. Check the Firebase SDK scripts and configuration.');
    }

    activeDb = firebaseServices.db;
    activeAuth = firebaseServices.auth;
    return { db: activeDb, auth: activeAuth, ready: true };
}

export function isStorageReady() {
    return Boolean(firebaseServices?.db && firebaseServices?.auth);
}

export function clearStoredAuthState() {
    localStorage.removeItem(SESSION_KEY);
}

export function subscribeCollection(collectionName, callback, constraints = []) {
    let query = activeDb.collection(collectionName);
    constraints.forEach((constraint) => {
        query = query.where(constraint.field, constraint.operator, constraint.value);
    });
    return query.onSnapshot((snapshot) => callback(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))));
}

export function addDocument(collectionName, payload) {
    return activeDb.collection(collectionName).add(payload);
}

export function updateDocument(collectionName, id, payload) {
    return activeDb.collection(collectionName).doc(id).update(payload);
}

export function deleteDocument(collectionName, id) {
    return activeDb.collection(collectionName).doc(id).delete();
}

export function saveDocument(collectionName, payload, id) {
    const reference = id ? activeDb.collection(collectionName).doc(id) : activeDb.collection(collectionName).doc();
    return reference.set(payload, { merge: Boolean(id) });
}

export function serverTimestamp() {
    return window.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date();
}

export function geoPoint(latitude, longitude) {
    return window.firebase?.firestore?.GeoPoint ? new window.firebase.firestore.GeoPoint(latitude, longitude) : { latitude, longitude };
}

window.addEventListener('storage', (event) => {
    if (event.key !== DATABASE_KEY) return;
    database = readDatabase();
    listeners.forEach((callbacks) => callbacks.forEach((callback) => callback()));
});

import { setupAuthRouter } from './auth.js';

function resolvePanel(role) {
    const map = {
        admin: './admin.html',
        seller: './seller.html',
        customer: './customer.html',
        delivery_person: './delivery.html'
    };
    return map[role] || './customer.html';
}

if (history.scrollRestoration) {
    history.scrollRestoration = 'manual';
}

window.addEventListener('load', () => {
    window.scrollTo(0, 0);
});

window.addEventListener('DOMContentLoaded', () => {
    setupAuthRouter({
        onRoleResolved: (role) => {
            const panelUrl = new URL(resolvePanel(role), window.location.href);
            panelUrl.search = window.location.search;
            panelUrl.hash = window.location.hash;
            window.location.replace(panelUrl.href);
        }
    });

    const toggleOtherRoles = document.getElementById('toggleOtherRoles');
    const otherRolesMenu = document.getElementById('otherRolesMenu');
    if (toggleOtherRoles && otherRolesMenu) {
        toggleOtherRoles.addEventListener('click', () => {
            otherRolesMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', (event) => {
            if (!otherRolesMenu.contains(event.target) && !toggleOtherRoles.contains(event.target)) {
                otherRolesMenu.classList.add('hidden');
            }
        });
    }

});

window.addEventListener('popstate', () => {
    const currentPath = window.location.pathname.toLowerCase();
    if (currentPath.includes('customer.html') || currentPath.includes('seller.html') || currentPath.includes('admin.html') || currentPath.includes('delivery.html')) {
        window.scrollTo(0, 0);
    }
});

(function () {
    'use strict';
    try {
        var initV = document.documentElement.getAttribute('data-initial-view');
        if (initV === 'notes' || initV === 'resume' || initV === 'shelf') {
            var vHome = document.getElementById('view-home');
            var vTarget = document.getElementById('view-' + initV);
            if (vHome && vTarget) {
                vHome.classList.remove('site-view-active');
                vHome.setAttribute('hidden', '');
                vTarget.classList.add('site-view-active');
                vTarget.removeAttribute('hidden');
            }
            if (initV === 'resume') {
                var resumeBanner = document.querySelector('#view-resume .essay-banner-img');
                if (resumeBanner) {
                    resumeBanner.loading = 'eager';
                    resumeBanner.fetchPriority = 'high';
                }
            }
        }
    } catch (_) {}
})();


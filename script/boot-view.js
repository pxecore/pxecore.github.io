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
        }

        function activateCss(target) {
            var links = document.querySelectorAll('link[data-defer-css="' + target + '"]');
            for (var i = 0; i < links.length; i++) {
                if (links[i].media !== 'all') links[i].media = 'all';
            }
        }
        window.__activateDeferredCss = activateCss;

        if (initV && initV !== 'home') {
            activateCss(initV);
        }

        var activateRemaining = function () {
            activateCss('always');
            activateCss('resume');
            activateCss('notes');
            activateCss('shelf');
        };
        if (document.readyState === 'complete') {
            activateRemaining();
        } else {
            window.addEventListener('load', activateRemaining, { once: true });
        }
    } catch (_) {}
})();


(function (window, document) {
    'use strict';

    const ScrollReveal = {
        init(options = {}) {
            const {
                selector = '.reveal-on-scroll',
                mode = 'once',
                rootMargin = '0px 0px -28% 0px',
                threshold = 0.01,
                visibility = { top: 0.72, bottom: 0 },
                observeRoot,
                toggleExitOffset = 140
            } = options;

            const observedElements = new WeakSet();
            const revealStates = new WeakMap();
            const isToggleMode = mode === 'toggle';
            let observer;
            let mutationObserver;

            const getRevealElements = () => Array.from(document.querySelectorAll(selector));
            const updateRevealState = (element, isVisible) => {
                const nextVisible = Boolean(isVisible);
                if (revealStates.get(element) === nextVisible) return;

                revealStates.set(element, nextVisible);
                if (isToggleMode) {
                    element.classList.toggle('is-visible', nextVisible);
                } else if (nextVisible) {
                    element.classList.add('is-visible');
                }
            };

            const isElementVisible = (element) => {
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                const rect = element.getBoundingClientRect();
                const wasVisible = revealStates.get(element) === true;
                const edgeOffset = isToggleMode && wasVisible ? toggleExitOffset : 0;

                return rect.top < viewportHeight * visibility.top + edgeOffset
                    && rect.bottom > viewportHeight * visibility.bottom - edgeOffset;
            };

            const revealVisibleElements = () => {
                getRevealElements().forEach(element => {
                    if (!isToggleMode && element.classList.contains('is-visible')) return;
                    updateRevealState(element, isElementVisible(element));
                });
            };

            const observeElements = () => {
                getRevealElements().forEach(element => {
                    if (observedElements.has(element)) return;

                    observedElements.add(element);
                    if (observer) observer.observe(element);
                });

                // toggle 模式会受 transform 反馈影响，容易在页面顶部/底部反复触发。
                // 因此只在 once 模式下使用 IntersectionObserver，toggle 模式统一走手动判定。
                if (!observer) revealVisibleElements();
            };

            if (!isToggleMode && 'IntersectionObserver' in window) {
                observer = new window.IntersectionObserver(entries => {
                    entries.forEach(entry => {
                        updateRevealState(entry.target, entry.isIntersecting);
                        if (entry.isIntersecting) {
                            observer.unobserve(entry.target);
                        }
                    });
                }, { rootMargin, threshold });
            }

            const start = () => {
                observeElements();

                if (observeRoot && 'MutationObserver' in window) {
                    const root = typeof observeRoot === 'string'
                        ? document.querySelector(observeRoot)
                        : observeRoot;

                    if (root) {
                        mutationObserver = new MutationObserver(observeElements);
                        mutationObserver.observe(root, { childList: true, subtree: true });
                    }
                }

                if (!observer) {
                    window.addEventListener('scroll', revealVisibleElements, { passive: true });
                    window.addEventListener('resize', revealVisibleElements, { passive: true });
                }
            };

            document.documentElement.classList.add('motion-ready');
            if (window.requestAnimationFrame) {
                window.requestAnimationFrame(start);
            } else {
                window.setTimeout(start, 0);
            }

            return {
                refresh: observeElements,
                destroy() {
                    window.removeEventListener('scroll', revealVisibleElements);
                    window.removeEventListener('resize', revealVisibleElements);
                    if (observer) observer.disconnect();
                    if (mutationObserver) mutationObserver.disconnect();
                }
            };
        }
    };

    window.ScrollReveal = ScrollReveal;
})(window, document);

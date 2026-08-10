
// 网站访问统计
function statistics() {
    var url = window.location.hostname;
    let getP = { 'url': url }
    $.get('https://api.china9.cn/api/getRealIpAddr')
        .done(function (res) {
            // 请求成功时的处理逻辑
            if (res) {
                getP.ip = res
            }
            jQuery.post('https://jzt2.china9.cn/api/statistics/submit', getP, function (e) {

            });
        })
        .fail(function (jqXHR, textStatus, errorThrown) {
            // 请求失败时的异常处理
            console.error('Error occurred:', textStatus, errorThrown);
            jQuery.post('https://jzt2.china9.cn/api/statistics/submit', getP, function (e) {

            });
        });
}

statistics();

// 全局图片占位兜底：图片加载失败或 src 为空时显示占位图
(function () {
    var PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">' +
        '<rect width="800" height="600" fill="#f0f2f5"/>' +
        '<g fill="none" stroke="#c3c9d2" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="290" y="215" width="220" height="170" rx="16"/>' +
        '<circle cx="352" cy="270" r="18"/>' +
        '<path d="M310 355l58-62 46 48 34-36 62 50"/>' +
        '</g></svg>'
    );

    function applyPlaceholder(img) {
        if (img.src === PLACEHOLDER) return;
        img.dataset.placeholderApplied = '1';
        img.src = PLACEHOLDER;
    }

    function checkImg(img) {
        var src = img.getAttribute('src');
        if (img.dataset.placeholderApplied && src !== PLACEHOLDER) {
            // Vue 后续绑定了真实地址，清除标记以便失败时可再次兜底
            delete img.dataset.placeholderApplied;
        }
        if (img.dataset.placeholderApplied) return;
        if (src === null || src === '' || src === 'null' || src === 'undefined') {
            applyPlaceholder(img);
        } else if (img.complete && img.naturalWidth === 0 && src.indexOf('data:') !== 0) {
            applyPlaceholder(img);
        }
    }

    // 加载失败（捕获阶段监听，error 不冒泡）
    document.addEventListener('error', function (e) {
        if (e.target && e.target.tagName === 'IMG') applyPlaceholder(e.target);
    }, true);

    function scanAll() {
        document.querySelectorAll('img').forEach(checkImg);
    }

    // Vue 异步渲染的图片：监听 DOM 变化（含 :src 绑定为空后属性变化）
    if ('MutationObserver' in window) {
        new MutationObserver(function () { scanAll(); })
            .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scanAll);
    } else {
        scanAll();
    }
    window.addEventListener('load', scanAll);
})();

document.documentElement.classList.add('motion-ready');

// 页面区块进入和离开视口时切换动画状态
const setupScrollReveal = () => {
    const revealElements = Array.from(document.querySelectorAll('.reveal-on-scroll'));
    if (revealElements.length === 0) return;

    const revealStates = new WeakMap();
    const edgeBuffer = 140;

    const updateRevealState = (element, isVisible) => {
        const nextVisible = Boolean(isVisible);
        if (revealStates.get(element) === nextVisible) return;
        revealStates.set(element, nextVisible);
        element.classList.toggle('is-visible', nextVisible);
    };

    const revealVisibleElements = () => {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        revealElements.forEach(element => {
            const rect = element.getBoundingClientRect();
            const wasVisible = revealStates.get(element) === true;
            const buffer = wasVisible ? edgeBuffer : 0;
            const isVisible = rect.top < viewportHeight * 0.88 + buffer
                && rect.bottom > viewportHeight * 0.12 - buffer;
            updateRevealState(element, isVisible);
        });
    };

    // 统一使用手动判定，避免 IntersectionObserver 与 scroll 回调在边界互相覆盖。
    revealVisibleElements();
    window.addEventListener('scroll', revealVisibleElements, {passive: true});
    window.addEventListener('resize', revealVisibleElements, {passive: true});
};
if (window.requestAnimationFrame) {
    window.requestAnimationFrame(setupScrollReveal);
} else {
    window.setTimeout(setupScrollReveal, 0);
}

window.__ModuleLoader__.load({
  id: '@local/moyue-reader',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const PANEL_ID = 'moyue-reader';
    const LOCALE_NS = 'moyue-reader';
    const READER_URL = 'http://127.0.0.1:7788/';

    const ZH = {
      $locale: 'zh',
      'panel.title': '墨阅',
      'panel.subtitle': '本地电子书阅读器',
      'panel.refresh': '刷新',
      'panel.external': '独立窗口',
      'panel.loading': '正在连接墨阅阅读器…',
      'panel.hint': '阅读器服务地址 127.0.0.1:7788',
      'panel.iframeTitle': '墨阅电子书阅读器',
    };
    const EN = {
      $locale: 'en',
      'panel.title': 'MoYue',
      'panel.subtitle': 'Local ebook reader',
      'panel.refresh': 'Refresh',
      'panel.external': 'Open window',
      'panel.loading': 'Connecting to MoYue reader…',
      'panel.hint': 'Reader service at 127.0.0.1:7788',
      'panel.iframeTitle': 'MoYue ebook reader',
    };

    const STYLES = `
      .moyue-panel {
        display: flex; flex-direction: column; height: 100%; min-height: 0;
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
      }
      .moyue-bar {
        display: flex; align-items: center; gap: 10px; flex: 0 0 auto;
        padding: 7px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-base);
      }
      .moyue-brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .moyue-brand-glyph {
        display: inline-flex; align-items: center; justify-content: center;
        width: 24px; height: 24px; border-radius: 7px;
        background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base);
        flex: 0 0 auto;
      }
      .moyue-titles { display: flex; flex-direction: column; min-width: 0; }
      .moyue-title { font-size: 13px; font-weight: 600; line-height: 18px; }
      .moyue-sub {
        font-size: 11px; line-height: 14px; color: var(--dsw-alias-label-secondary);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .moyue-actions { margin-left: auto; display: flex; gap: 6px; flex: 0 0 auto; }
      .moyue-btn {
        height: 26px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary);
        font: inherit; font-size: 12px; line-height: 1; cursor: pointer;
      }
      .moyue-btn:hover { background: var(--dsw-alias-bg-layer-2); }
      .moyue-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .moyue-body { position: relative; flex: 1 1 auto; min-height: 0; }
      .moyue-frame {
        position: absolute; inset: 0; width: 100%; height: 100%;
        border: 0; background: var(--dsw-alias-bg-base); display: block;
      }
      .moyue-veil {
        position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 10px;
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary);
        font-size: 13px; transition: opacity .25s ease;
      }
      .moyue-veil[data-hidden="true"] { opacity: 0; pointer-events: none; }
      .moyue-spinner {
        width: 22px; height: 22px; border-radius: 50%;
        border: 2px solid var(--dsw-alias-border-l2);
        border-top-color: var(--dsw-alias-brand-primary);
        animation: moyue-spin .9s linear infinite;
      }
      @keyframes moyue-spin { to { transform: rotate(360deg); } }
      .moyue-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }
    `;

    function BookGlyph({ size }) {
      return h(
        'svg',
        {
          width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round',
          strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
        },
        h('path', { d: 'M2.5 3.4c1.6-.9 3.4-.9 5.5.2v9.2c-2.1-1.1-3.9-1.1-5.5-.2V3.4Z' }),
        h('path', { d: 'M13.5 3.4c-1.6-.9-3.4-.9-5.5.2v9.2c2.1-1.1 3.9-1.1 5.5-.2V3.4Z' }),
        h('path', { d: 'M4.9 6.4h1.7M4.9 8.6h1.7' }),
      );
    }

    // Sidebar entry: the host passes the requested square edge and selection state.
    function SidebarIcon({ size }) {
      return h(BookGlyph, { size: size || 16 });
    }

    function ReaderPanel({ readerUrl }) {
      const [nonce, setNonce] = React.useState(0);
      const [loaded, setLoaded] = React.useState(false);
      const url = readerUrl || READER_URL;
      const reload = () => {
        setLoaded(false);
        setNonce((value) => value + 1);
      };
      const openExternal = () => {
        try {
          window.open(url, '_blank', 'noopener,noreferrer');
        } catch (_) { /* the embedded view still works */ }
      };
      return h(
        'div',
        { className: 'moyue-panel', 'data-moyue-panel': '' },
        h('style', null, STYLES),
        h(
          'div',
          { className: 'moyue-bar' },
          h(
            'div',
            { className: 'moyue-brand' },
            h('span', { className: 'moyue-brand-glyph' }, h(BookGlyph, { size: 15 })),
            h(
              'div',
              { className: 'moyue-titles' },
              h('div', { className: 'moyue-title' }, '墨阅'),
              h('div', { className: 'moyue-sub' }, '本地电子书阅读器'),
            ),
          ),
          h(
            'div',
            { className: 'moyue-actions' },
            h('button', { type: 'button', className: 'moyue-btn', onClick: reload }, '刷新'),
            h('button', { type: 'button', className: 'moyue-btn', onClick: openExternal }, '独立窗口'),
          ),
        ),
        h(
          'div',
          { className: 'moyue-body' },
          h('iframe', {
            key: nonce,
            className: 'moyue-frame',
            src: url,
            title: '墨阅电子书阅读器',
            allow: 'clipboard-read; clipboard-write; fullscreen',
            onLoad: () => {
              window.setTimeout(() => setLoaded(true), 350);
            },
          }),
          h(
            'div',
            { className: 'moyue-veil', 'data-hidden': loaded ? 'true' : 'false' },
            h('div', { className: 'moyue-spinner' }),
            h('div', null, '正在连接墨阅阅读器…'),
            h('div', { className: 'moyue-hint' }, '首次打开会自动启动本地服务，请稍候'),
          ),
        ),
      );
    }

    return {
      name: 'moyue-reader',
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(LOCALE_NS, { zh: ZH, en: EN }),
          'moyue-reader: locale dictionaries',
        );
        const t = ctx.locale.bind(LOCALE_NS);

        ctx.effect(() => {
          if (typeof ctx.inject !== 'function') return () => {};
          return ctx.inject(['layout', 'slots', 'locale'], (pageCtx) => {
            const readerUrl = READER_URL;
            const stopMain = pageCtx.slots.inject('main', () =>
              pageCtx.slots.register(
                {
                  name: 'main',
                  key: PANEL_ID,
                  locale: LOCALE_NS,
                  inject: () => ({ readerUrl }),
                },
                ReaderPanel,
              ),
            );
            const stopSidebar = pageCtx.slots.inject('sidebar.panellist', () =>
              pageCtx.slots.register(
                {
                  name: 'sidebar.panellist',
                  id: PANEL_ID,
                  order: 20,
                  locale: LOCALE_NS,
                  label: () => pageCtx.locale.bind(LOCALE_NS)('panel.title'),
                },
                SidebarIcon,
              ),
            );
            return () => {
              stopSidebar();
              stopMain();
            };
          });
        }, 'moyue-reader: sidebar entry and main panel');
      },
    };
  },
});

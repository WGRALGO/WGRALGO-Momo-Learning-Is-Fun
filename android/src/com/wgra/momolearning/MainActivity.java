package com.wgra.momolearning;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetFileDescriptor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * The Momma Lewis Momo Learning Is FUN (the public app, ages 2-7). The app is the web page in assets/web, shown full screen in a WebView and
 * served from a private address (https://momo.app/) that this activity answers itself from inside the APK; nothing is
 * fetched from the internet (the app has no internet permission). Videos and voice clips are stored uncompressed and
 * served with byte ranges, so they start at once and can be replayed.
 */
public class MainActivity extends Activity {
    static final String HOST = "momo.app";
    static final String START = "https://" + HOST + "/index.html";
    static final String VERSION = "1.1.0";
    static final int PURPLE = 0xFF542282;
    WebView web;
    /** Until the page has drawn its splash, nothing is drawn, so the launch screen (logo on purple) stays up. */
    private boolean pageReady = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.setStatusBarColor(PURPLE);
        w.setNavigationBarColor(PURPLE);
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);     // no screen timeout while a child thinks
        // test builds (debuggable) let the desktop drive the page for the emulator checks
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(PURPLE);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // Momo's intro and the questions speak by themselves
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient() {
            // no grey "play" picture before a video's first frame
            @Override public Bitmap getDefaultVideoPoster() { return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888); }
        });
        web.setOnLongClickListener(new View.OnLongClickListener() { @Override public boolean onLongClick(View v) { return true; } });
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);
        // The app reaches into the camera cutout's edge (purple there), the page stays clear of the camera itself.
        final FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(PURPLE);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams a = w.getAttributes();
            a.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(a);
        }
        // The page shrinks above the keyboard (the name screen's text box), and stays clear of the camera cutout.
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int l = 0, t = 0, r = 0, b = 0;
                if (Build.VERSION.SDK_INT >= 28) {
                    DisplayCutout c = insets.getDisplayCutout();
                    if (c != null) { l = c.getSafeInsetLeft(); t = c.getSafeInsetTop(); r = c.getSafeInsetRight(); b = c.getSafeInsetBottom(); }
                }
                int ime;
                if (Build.VERSION.SDK_INT >= 30) ime = insets.getInsets(WindowInsets.Type.ime()).bottom;
                else {
                    // before Android 11 the keyboard shows up as a big bottom inset (adjustResize); a nav bar is small
                    int sys = insets.getSystemWindowInsetBottom();
                    ime = sys > v.getHeight() * 0.15 ? sys : 0;
                }
                b = Math.max(b, ime);
                FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) web.getLayoutParams();
                if (lp.leftMargin != l || lp.topMargin != t || lp.rightMargin != r || lp.bottomMargin != b) {
                    lp.setMargins(l, t, r, b);
                    web.setLayoutParams(lp);
                }
                return insets;
            }
        });
        setContentView(root);
        final View content = findViewById(android.R.id.content);
        content.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
            @Override public boolean onPreDraw() {
                if (!pageReady) return false;
                content.getViewTreeObserver().removeOnPreDrawListener(this);
                return true;
            }
        });
        web.postDelayed(new Runnable() { @Override public void run() { showPage(); } }, 3000);   // never wait longer than this
        hideBars();
        web.loadUrl(START);
    }

    /** Full screen for the kids: the status and navigation bars hide (a swipe from the edge shows them for a moment). */
    void hideBars() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    @Override
    protected void onPause() {
        // the app goes to the background: hold whatever is playing
        if (web != null) web.evaluateJavascript("window.__momoPause&&window.__momoPause()", null);
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideBars();
        if (web != null) web.evaluateJavascript("window.__momoResume&&window.__momoResume()", null);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__momoBack ? window.__momoBack() : false", new ValueCallback<String>() {
            @Override public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) finish();
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    void showPage() {
        if (pageReady || web == null) return;
        pageReady = true;
        findViewById(android.R.id.content).invalidate();
    }

    private final class Client extends WebViewClient {
        @Override
        public void onPageFinished(WebView v, String url) {
            // let the page paint its own splash (the logo big) first, then show it
            v.postDelayed(new Runnable() { @Override public void run() { showPage(); } }, 150);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            return !HOST.equals(r.getUrl().getHost());     // stay inside the app
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if (!HOST.equals(u.getHost())) return status(404, "text/plain", new byte[0]);
            String path = u.getPath() == null ? "/" : u.getPath();
            if (path.equals("/") || path.isEmpty()) path = "/index.html";
            if (path.contains("..")) return status(404, "text/plain", new byte[0]);
            String asset = "web" + path, type = mime(path);
            if (path.endsWith(".mp4") || path.endsWith(".mp3")) return media(asset, type, r.getRequestHeaders());
            try {
                return status(200, type, readAll(getAssets().open(asset)));
            } catch (IOException e) {
                return status(404, "text/plain", new byte[0]);
            }
        }

        /** A video or voice clip, whole or the byte range the player asks for. */
        private WebResourceResponse media(String asset, String type, Map<String, String> req) {
            AssetFileDescriptor fd;
            try {
                fd = getAssets().openFd(asset);              // stored uncompressed (build.sh: aapt2 -0 mp4 -0 mp3)
            } catch (IOException e) {
                return status(404, "text/plain", new byte[0]);
            }
            long total = fd.getLength(), start = 0, end = total - 1;
            boolean partial = false;
            String range = null;
            if (req != null) for (Map.Entry<String, String> e : req.entrySet()) if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
            if (range != null && range.trim().startsWith("bytes=")) {
                String[] p = range.trim().substring(6).split(",")[0].trim().split("-", -1);
                try {
                    if (p[0].isEmpty()) { start = Math.max(0, total - Long.parseLong(p[1].trim())); }
                    else {
                        start = Long.parseLong(p[0].trim());
                        if (p.length > 1 && !p[1].trim().isEmpty()) end = Math.min(total - 1, Long.parseLong(p[1].trim()));
                    }
                    partial = true;
                } catch (NumberFormatException | ArrayIndexOutOfBoundsException ignored) { start = 0; end = total - 1; }
                if (start > end || start >= total) {
                    try { fd.close(); } catch (IOException ignored) { }
                    Map<String, String> h = new HashMap<>();
                    h.put("Content-Range", "bytes */" + total);
                    return new WebResourceResponse(type, null, 416, "Range Not Satisfiable", h, new ByteArrayInputStream(new byte[0]));
                }
            }
            try {
                InputStream in = fd.createInputStream();
                long left = start;
                while (left > 0) { long k = in.skip(left); if (k <= 0) break; left -= k; }
                long len = end - start + 1;
                Map<String, String> h = new HashMap<>();
                h.put("Accept-Ranges", "bytes");
                h.put("Content-Length", String.valueOf(len));
                if (partial) h.put("Content-Range", "bytes " + start + "-" + end + "/" + total);
                return new WebResourceResponse(type, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", h, new Limited(in, len));
            } catch (IOException e) {
                return status(404, "text/plain", new byte[0]);
            }
        }

        private WebResourceResponse status(int code, String type, byte[] body) {
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-store");
            String reason = code == 200 ? "OK" : code == 404 ? "Not Found" : "Error";
            return new WebResourceResponse(type, "utf-8", code, reason, h, new ByteArrayInputStream(body));
        }

        private String mime(String p) {
            if (p.endsWith(".html")) return "text/html";
            if (p.endsWith(".css")) return "text/css";
            if (p.endsWith(".js")) return "text/javascript";
            if (p.endsWith(".png")) return "image/png";
            if (p.endsWith(".jpg")) return "image/jpeg";
            if (p.endsWith(".webp")) return "image/webp";
            if (p.endsWith(".svg")) return "image/svg+xml";
            if (p.endsWith(".ttf")) return "font/ttf";
            if (p.endsWith(".mp4")) return "video/mp4";
            if (p.endsWith(".mp3")) return "audio/mpeg";
            if (p.endsWith(".json")) return "application/json";
            return "application/octet-stream";
        }
    }

    /** Reads at most n bytes of a stream. */
    static final class Limited extends InputStream {
        private final InputStream in;
        private long left;
        Limited(InputStream in, long n) { this.in = in; this.left = n; }
        @Override public int read() throws IOException { if (left <= 0) return -1; int b = in.read(); if (b >= 0) left--; return b; }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = in.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
        @Override public int available() throws IOException { return (int) Math.min(in.available(), left); }
        @Override public void close() throws IOException { in.close(); }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }
}

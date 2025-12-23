(function(){
  if (window.__removeChildTracerActive) {
    console.log('removeChild tracer already active');
    return;
  }

  const orig = Node.prototype.removeChild;
  window.__origRemoveChild = orig;
  window.__removeChildTracerActive = true;

  Node.prototype.removeChild = function(child) {
    try {
      const parent = this;
      const stack = (new Error('trace')).stack || '';
      const info = {
        time: new Date().toISOString(),
        parentTag: parent && parent.tagName,
        childTag: child && child.tagName,
        // limit sizes to keep clipboard small
        childOuter: child && child.outerHTML ? String(child.outerHTML).slice(0, 2000) : undefined,
        parentOuter: parent && parent.outerHTML ? String(parent.outerHTML).slice(0, 2000) : undefined,
        stack,
      };

      // log to console
      console.log('removeChild tracer captured:', info);

      // try to copy JSON to clipboard for easy pasting
      try {
        copy(JSON.stringify(info));
        console.log('Captured info copied to clipboard as JSON.');
      } catch (e) {
        console.warn('Could not copy to clipboard (copy() may be unavailable).');
      }

      // pause execution so you can inspect `this` and `child` in DevTools
      debugger; // eslint-disable-line no-debugger

      // restore original implementation after first capture
      Node.prototype.removeChild = window.__origRemoveChild || orig;
      delete window.__origRemoveChild;
      window.__removeChildTracerActive = false;

      return orig.call(this, child);
    } catch (err) {
      try { return orig.call(this, child); } catch (e) { throw e; }
    }
  };

  console.log('removeChild tracer installed. It will pause on the next removeChild call and copy capture to clipboard.');
})();
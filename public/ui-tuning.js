(() => {
  const nativeSetInterval = window.setInterval.bind(window);
  window.setInterval = (handler, timeout, ...args) => {
    const tunedTimeout = timeout === 520 ? 2500 : timeout;
    return nativeSetInterval(handler, tunedTimeout, ...args);
  };
})();

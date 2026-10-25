/** Keep the preferred width when a smaller window temporarily constrains it. */
export function attachSidebarResize(sidebar: HTMLElement, divider: HTMLElement, initialWidth: number | undefined, save: (width: number) => void): void {
  let preferredWidth = initialWidth;
  let drag: { id: number; x: number; width: number } | undefined;
  const maximum = () => Math.max(180, Math.min(480, window.innerWidth - 440));
  const render = () => {
    const width = Math.max(180, Math.min(maximum(), preferredWidth ?? (window.innerWidth <= 800 ? 192 : 232)));
    sidebar.style.width = `${width}px`;
    divider.setAttribute('aria-valuemin', '180');
    divider.setAttribute('aria-valuemax', String(maximum()));
    divider.setAttribute('aria-valuenow', String(width));
    divider.setAttribute('aria-valuetext', `${width} pixels`);
  };
  const setWidth = (width: number) => {
    preferredWidth = Math.max(180, Math.min(maximum(), Math.round(width)));
    render();
  };
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    divider.focus();
    divider.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width };
    document.body.classList.add('resizing-sidebar');
  });
  divider.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) setWidth(drag.width + event.clientX - drag.x);
  });
  const finish = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    document.body.classList.remove('resizing-sidebar');
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    if (preferredWidth !== undefined) save(preferredWidth);
  };
  divider.addEventListener('pointerup', finish);
  divider.addEventListener('pointercancel', finish);
  divider.addEventListener('lostpointercapture', finish);
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const width = sidebar.getBoundingClientRect().width;
    setWidth(event.key === 'Home' ? 180 : event.key === 'End' ? maximum() : width + (event.key === 'ArrowLeft' ? -10 : 10));
    save(preferredWidth!);
  });
  divider.addEventListener('dblclick', () => {
    setWidth(window.innerWidth <= 800 ? 192 : 232);
    save(preferredWidth!);
  });
  window.addEventListener('resize', render);
  render();
}

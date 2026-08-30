/** Monochrome artwork tinted by its control; the host continues to own the asset. */
export function MaskIcon({ src }: { src: string }) {
  return <span className="ui-mask-icon" aria-hidden="true" style={{ maskImage: `url(${JSON.stringify(src)})` }} />;
}

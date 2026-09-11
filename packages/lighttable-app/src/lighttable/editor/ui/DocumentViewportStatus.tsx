import React from 'react';

export const DocumentViewportStatus = ({ error, loading, resident, ready, unavailable }: {
  error?: string | null;
  loading: boolean;
  resident: boolean;
  ready: boolean;
  unavailable: boolean;
}) => {
  if (error) return (
    <div className="lighttable-viewport__message lighttable-viewport__message--error" role="alert">
      {`Rendering stopped.\n\n${error}`}
    </div>
  );
  if (loading || !resident) return (
    <div className="lighttable-viewport__message">Loading image and WebGPU pipeline...</div>
  );
  if (ready && unavailable) return (
    <div className="lighttable-viewport__message">LightTable is unavailable for this image.</div>
  );
  return null;
};

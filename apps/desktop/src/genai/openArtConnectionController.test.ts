import { describe, expect, it } from 'vitest';
import { readOpenArtSignedUpload } from './openArtConnectionController';

describe('readOpenArtSignedUpload', () => {
  it('reads the explicit signed PUT descriptor and its required headers', () => {
    expect(readOpenArtSignedUpload({
      result: {
        upload_url: 'https://uploads.example.test/object?X-Amz-Signature=secret',
        access_url: 'https://cdn.example.test/object',
        required_headers: { 'Content-Type': 'image/png', 'x-upload-token': 'secret' }
      }
    })).toEqual({
      uploadUrl: 'https://uploads.example.test/object?X-Amz-Signature=secret',
      headers: { 'Content-Type': 'image/png', 'x-upload-token': 'secret' }
    });
  });

  it('accepts a generic URL only when its query proves that it is signed', () => {
    expect(readOpenArtSignedUpload({
      url: 'https://uploads.example.test/object?sig=secret&se=tomorrow',
      accessURL: 'https://cdn.example.test/object'
    })?.uploadUrl).toBe('https://uploads.example.test/object?sig=secret&se=tomorrow');
  });

  it('reads the signURL field returned by the current OpenArt MCP contract', () => {
    expect(readOpenArtSignedUpload({
      uploadId: 'upload-1',
      signURL: 'https://uploads.example.test/object',
      accessURL: 'https://cdn.example.test/object',
      contentType: 'image/png'
    })?.uploadUrl).toBe('https://uploads.example.test/object');
  });

  it('never mistakes the durable access URL for a signed upload endpoint', () => {
    expect(readOpenArtSignedUpload({
      url: 'https://cdn.example.test/object',
      accessURL: 'https://cdn.example.test/object'
    })).toBeNull();
  });
});

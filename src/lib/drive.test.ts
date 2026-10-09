import { multipartBody } from './drive';

jest.mock('./supabase', () => ({ getGoogleRefreshToken: jest.fn(), getSession: jest.fn() }));

describe('multipartBody', () => {
  it('frames metadata and content as multipart/related', () => {
    const { body, contentType } = multipartBody({ name: 'a.json', appProperties: { pid: '1' } }, new Uint8Array([104, 105]), 'application/json', 'B');
    expect(contentType).toBe('multipart/related; boundary=B');
    expect(new TextDecoder().decode(body)).toBe(
      '--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.json","appProperties":{"pid":"1"}}\r\n' +
        '--B\r\nContent-Type: application/json\r\n\r\nhi\r\n--B--',
    );
  });

  it('keeps binary content byte for byte', () => {
    const data = new Uint8Array([0, 255, 13, 10, 45, 45]);
    const { body } = multipartBody({}, data, 'audio/wav', 'B');
    const head = new TextEncoder().encode('--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--B\r\nContent-Type: audio/wav\r\n\r\n').length;
    expect([...body.slice(head, head + data.length)]).toEqual([...data]);
  });
});

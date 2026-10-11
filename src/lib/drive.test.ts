import { browseChildren, multipartBody } from './drive';
import * as supabase from './supabase';

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

describe('browseChildren', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** A Drive that answers the token request and records every file query. */
  function drive(files: unknown[]) {
    (supabase.getGoogleRefreshToken as jest.Mock).mockResolvedValue('1//r');
    (supabase.getSession as jest.Mock).mockResolvedValue({ access_token: 'sb' });
    const queries: string[] = [];
    globalThis.fetch = jest.fn(async (url: string) => {
      if (url.includes('drive-token')) return new Response(JSON.stringify({ accessToken: 'ya29', expiresIn: 3600 }));
      queries.push(new URL(url).searchParams.get('q') ?? '');
      return new Response(JSON.stringify({ files }));
    }) as unknown as typeof fetch;
    return queries;
  }

  it('asks for the folders of the user without parent to find the computers, and returns only those', async () => {
    const queries = drive([
      { id: 'mac', name: 'My Mac', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'in', name: 'Loops', mimeType: 'application/vnd.google-apps.folder', parents: ['r'] },
    ]);
    expect((await browseChildren('__computers')).map((f) => f.name)).toEqual(['My Mac']);
    expect(queries[0]).toBe("mimeType = 'application/vnd.google-apps.folder' and 'me' in owners and trashed = false");
  });

  it('lists what is shared with the user and the children of a normal folder', async () => {
    const queries = drive([]);
    await browseChildren('__shared');
    await browseChildren('abc');
    expect(queries).toEqual(['sharedWithMe = true and trashed = false', "'abc' in parents and trashed = false"]);
  });
});

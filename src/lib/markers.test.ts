import { addMarker, moveMarker, nextMarker, removeMarker, renameMarker, withMarkers } from './markers';
import { createProject } from './project';

describe('markers', () => {
  it('adds sorted markers on beats and renames one already on the bar', () => {
    let p = addMarker(createProject(), 16.1);
    p = addMarker(p, 4, 'Intro');
    expect(p.markers!.map((m) => [m.bar, m.name])).toEqual([[4, 'Intro'], [16, 'Marker 1']]);
    p = addMarker(p, 4, 'Start');
    expect(p.markers!).toHaveLength(2);
    expect(p.markers![0].name).toBe('Start');
  });
  it('renames, moves and removes', () => {
    let p = addMarker(addMarker(createProject(), 8, 'A'), 16, 'B');
    const [a, b] = p.markers!;
    p = renameMarker(p, a.id, '  Drop  ');
    expect(p.markers![0].name).toBe('Drop');
    expect(renameMarker(p, a.id, '   ').markers![0].name).toBe('Drop');
    p = moveMarker(p, a.id, 20);
    expect(p.markers!.map((m) => m.name)).toEqual(['B', 'Drop']);
    p = removeMarker(removeMarker(p, a.id), b.id);
    expect(p.markers).toBeUndefined();
  });
  it('finds the next and previous marker', () => {
    const p = withMarkers(createProject(), [{ bar: 32, name: 'Drop' }, { bar: 0, name: 'Intro' }, { bar: 16, name: 'Build' }]);
    expect(nextMarker(p, 0, 1)?.name).toBe('Build');
    expect(nextMarker(p, 16, -1)?.name).toBe('Intro');
    expect(nextMarker(p, 40, 1)).toBeUndefined();
  });
});

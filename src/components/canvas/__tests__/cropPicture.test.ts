import { describe, expect, it } from 'vitest'
import { pictureCropBox } from '../useCropSession'

const pic = { x: 100, y: 50, w: 200, h: 100, rotation: 0 }

describe('pictureCropBox', () => {
  it('keeps the center put when the kept part is centered', () => {
    expect(pictureCropBox(pic, 50, 20, 100, 60)).toEqual({ x: 150, y: 70, w: 100, h: 60 })
  })

  it('moves the box to where the kept part was, on an unrotated picture', () => {
    // Keeping the left half: the box shrinks toward the left edge.
    expect(pictureCropBox(pic, 0, 0, 100, 100)).toEqual({ x: 100, y: 50, w: 100, h: 100 })
  })

  it('shrinks toward the cropped side along the picture\'s own axes when rotated', () => {
    // A picture turned 90° clockwise has its left edge pointing up the canvas,
    // so keeping its left half leaves the box on the upper half.
    const box = pictureCropBox({ ...pic, rotation: 90 }, 0, 0, 100, 100)
    expect(box.x).toBeCloseTo(150)
    expect(box.y).toBeCloseTo(0)
    expect(box.w).toBe(100)
    expect(box.h).toBe(100)
  })
})

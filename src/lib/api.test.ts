import { describe, expect, it } from 'vitest'
import { mapDataset } from './api'

describe('CNN dataset response mapping', () => {
  it('keeps the project association and class metadata', () => {
    expect(mapDataset({
      id: 8,
      project_id: 3,
      name: 'Products',
      filename: 'products.zip',
      version: 2,
      status: 'Validado',
      metadata: { images: 120, class_count: 4, classes: ['a', 'b', 'c', 'd'] },
    })).toEqual({
      id: '8',
      projectId: '3',
      name: 'Products',
      rows: '120',
      features: 4,
      format: 'Imágenes',
      status: 'Validado',
      updated: 'v2',
    })
  })
})

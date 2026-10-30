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
      family: 'CNN',
      rows: '120',
      features: 4,
      format: 'ZIP · imágenes',
      status: 'Validado',
      updated: 'v2',
    })
  })

  describe('Feedforward dataset response mapping', () => {
    it('uses tabular row counts and the saved family', () => {
      expect(mapDataset({
        id: 9,
        project_id: 3,
        name: 'Temperatures',
        filename: 'temperatures.csv',
        version: 1,
        status: 'Validado',
        metadata: {
          family: 'Feedforward',
          rows: 24,
          class_count: 2,
          classes: ['cold', 'warm'],
          feature_names: ['temperature', 'humidity'],
        },
      })).toMatchObject({
        family: 'Feedforward',
        rows: '24',
        format: 'CSV · tabular',
        features: 2,
      })
    })
  })
})

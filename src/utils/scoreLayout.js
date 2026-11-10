export const PORTRAIT_QUERY = '(orientation: portrait)'

export function scorePageSize(orientation) {
  return orientation === 'portrait'
    ? { pageWidth: 1560, pageHeight: 2200 }
    : { pageWidth: 2100, pageHeight: 1115 }
}

export function indexScorePages(toolkit, measureIds, orientation) {
  const pageByBarId = new Map()
  const firstBarByPage = new Map()
  for (const id of measureIds) {
    const page = toolkit.getPageWithElement(id)
    if (page <= 0) continue
    pageByBarId.set(id, page)
    if (!firstBarByPage.has(page)) firstBarByPage.set(page, id)
  }
  return { orientation, pageCount: toolkit.getPageCount(), pageByBarId, firstBarByPage, pages: new Map() }
}

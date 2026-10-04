import AppKit

func runOCRTests() {
    func labels(_ text: String) -> Set<String> { Set(namedRanges(in: text).map { $0.0 }) }
    assert(labels("Safari File Edit View History Bookmarks") == ["View"])
    assert(labels("Zoom In ⌘+ Zoom Out ⌘−") == ["Zoom In", "Zoom Out"])
    assert(labels("파일 편집 보기 방문 기록 북마크") == ["보기"])
    assert(labels("미리보기 다운로드한파일 reviewing DownloadsBackup") == [])
    assert(labels("Unmute") == ["Unmute"])
    assert(labels("음소거 해제") == ["음소거 해제"])
    assert(labels("Recent Downloads Applications") == ["Downloads"])
    let ranged = "Safari File Edit View History"
    assert(namedRanges(in: ranged).map { String(ranged[$0.1]) } == ["View"])
    let negativeDisplay = CGRect(x: -1707, y: -1440, width: 2560, height: 50)
    let transformed = globalRect(CGRect(x: 0.1, y: 0.5, width: 0.2, height: 0.1), in: negativeDisplay)
    assert(abs(transformed.minX + 1451) < 0.001 && abs(transformed.minY + 1420) < 0.001 && abs(transformed.width - 512) < 0.001 && abs(transformed.height - 5) < 0.001)
    print("9 OCR token and global geometry checks passed")
}

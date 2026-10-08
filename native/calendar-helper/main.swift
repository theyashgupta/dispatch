import EventKit
import Foundation

func emit(_ object: [String: Any], exitCode: Int32 = 0) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(exitCode)
}

func currentStatus() -> Int {
    return EKEventStore.authorizationStatus(for: .event).rawValue
}

func text(_ value: String?) -> String? {
    guard let value = value, !value.isEmpty else { return nil }
    return value
}

func cut(_ value: String, _ limit: Int) -> String {
    let units = Array(value.utf16.prefix(limit))
    return String(decoding: units, as: UTF16.self)
}

func parseDate(_ value: Any?) -> Date? {
    guard let raw = value as? String else { return nil }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: raw) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: raw)
}

func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(identifier: "UTC")
    return formatter.string(from: date)
}

func readCalendars(_ store: EKEventStore) {
    let calendars = store.calendars(for: .event).map { calendar -> [String: Any] in
        return ["title": calendar.title, "source": calendar.source?.title ?? ""]
    }
    emit(["status": 3, "calendars": calendars])
}

func readEvents(_ store: EKEventStore, _ rawArgs: String) {
    guard
        let data = rawArgs.data(using: .utf8),
        let args = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        let from = parseDate(args["from"]),
        let to = parseDate(args["to"])
    else {
        emit(["error": "bad-args"], exitCode: 64)
    }
    let wanted = (args["calendars"] as? [String]) ?? []
    let ignoredPattern = (args["ignored"] as? String) ?? ""
    var ignored: NSRegularExpression? = nil
    if !ignoredPattern.isEmpty {
        guard
            ignoredPattern.count <= 200,
            let compiled = try? NSRegularExpression(pattern: ignoredPattern, options: [.caseInsensitive])
        else {
            emit(["error": "bad-args"], exitCode: 64)
        }
        ignored = compiled
    }
    var titles: [String] = []
    let calendars = store.calendars(for: .event).filter { calendar in
        let title = calendar.title
        titles.append(title)
        if !wanted.isEmpty { return wanted.contains(title) }
        let range = NSRange(title.startIndex..., in: title)
        return ignored?.firstMatch(in: title, options: [], range: range) == nil
    }
    if calendars.isEmpty {
        if wanted.isEmpty { emit(["status": 3, "events": [Any]()]) }
        emit(["status": 3, "error": "calendars-missing"])
    }
    let partial = wanted.contains { !titles.contains($0) }
    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars)
    let events = store.events(matching: predicate).map { event -> [String: Any] in
        var out: [String: Any] = [
            "uid": text(event.calendarItemExternalIdentifier) ?? text(event.eventIdentifier) ?? "",
            "title": text(event.title) ?? "",
            "start": iso(event.startDate),
            "end": iso(event.endDate),
            "allDay": event.isAllDay,
            "calendar": text(event.calendar?.title) ?? "",
        ]
        if let location = text(event.location) { out["location"] = location }
        if let url = event.url, let absolute = text(url.absoluteString) { out["url"] = absolute }
        if let notes = text(event.notes) { out["notes"] = cut(notes, 4000) }
        return out
    }
    emit(["status": 3, "events": events, "partial": partial])
}

let arguments = Array(CommandLine.arguments.dropFirst())
let command = arguments.first ?? ""

switch command {
case "status":
    emit(["status": currentStatus()])
case "request":
    let requested = arguments.count > 1 ? (Double(arguments[1]) ?? 120) : 120
    let seconds = requested.isFinite ? min(max(requested, 1), 300) : 120
    let store = EKEventStore()
    let semaphore = DispatchSemaphore(value: 0)
    store.requestFullAccessToEvents { _, _ in semaphore.signal() }
    let answered = semaphore.wait(timeout: .now() + seconds) == .success
    if answered { emit(["status": currentStatus()]) }
    emit(["status": currentStatus(), "timedOut": true])
case "calendars":
    let status = currentStatus()
    if status != 3 { emit(["status": status]) }
    readCalendars(EKEventStore())
case "events":
    let status = currentStatus()
    if status != 3 { emit(["status": status]) }
    readEvents(EKEventStore(), arguments.count > 1 ? arguments[1] : "")
default:
    emit(["error": "unknown-command"], exitCode: 64)
}

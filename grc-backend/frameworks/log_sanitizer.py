import ipaddress
import re


_SECRET_FIELD = re.compile(
    r"(?i)(\b(?:password|passwd|pwd|authorization|proxy-authorization|"
    r"[\w-]*token|[\w-]*api[_-]?key|client[_-]?secret|secret(?:[_-]?key)?|"
    r"cookie|set-cookie|csrf(?:[_-]?token)?|session(?:[_-]?id)?|private[_-]?key)"
    r"\b\s*[:=]\s*)"
    r'(?:(?:Bearer|Basic|Token)\s+)?(?:"[^"]*"|\'[^\']*\'|[^\s,;&}\]]+)'
)
_IDENTITY_FIELD = re.compile(
    r"(?i)(\b(?:username|user_name|user|email|ip_address|client_ip|remote_addr|"
    r"device_info|device|location|first_name|last_name|full_name|user_id)\b"
    r"\s*[:=]\s*)(?:" r'"[^"]*"|\'[^\']*\'|[^\s,;&}\]]+)'
)
_BEARER_CREDENTIAL = re.compile(r"(?i)\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")
_URL_CREDENTIAL = re.compile(r"(\b[a-z][a-z0-9+.-]*://)[^/@\s]+@")
_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_IPV4 = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")
_IPV6_CANDIDATE = re.compile(r"(?<![\w:])(?:[0-9a-f]{0,4}:){2,}[0-9a-f:.%]{0,45}(?![\w:])", re.IGNORECASE)


def _redact_ipv4(match):
    try:
        ipaddress.IPv4Address(match.group())
    except ipaddress.AddressValueError:
        return match.group()
    return "[REDACTED_IP]"


def _redact_ipv6(match):
    try:
        ipaddress.IPv6Address(match.group())
    except ipaddress.AddressValueError:
        return match.group()
    return "[REDACTED_IP]"


def sanitize_log_line(line):
    """Redact common credentials and identifying values from an operational log line."""
    sanitized = _URL_CREDENTIAL.sub(r"\1[REDACTED]@", line)
    sanitized = _SECRET_FIELD.sub(r"\1[REDACTED]", sanitized)
    sanitized = _BEARER_CREDENTIAL.sub("[REDACTED_CREDENTIAL]", sanitized)
    sanitized = _JWT.sub("[REDACTED_CREDENTIAL]", sanitized)
    sanitized = _IDENTITY_FIELD.sub(r"\1[REDACTED]", sanitized)
    sanitized = _EMAIL.sub("[REDACTED_EMAIL]", sanitized)
    sanitized = _IPV4.sub(_redact_ipv4, sanitized)
    return _IPV6_CANDIDATE.sub(_redact_ipv6, sanitized)

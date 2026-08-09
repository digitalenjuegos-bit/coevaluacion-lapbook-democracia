#!/usr/bin/env python3
"""hermes-qc-validate.py — Autonomous QC validation for IB NM quizzes"""
import sys, re
from pathlib import Path

def validate(html_path):
    html = Path(html_path).read_text(encoding='utf-8')
    qb_start = html.find('const QUESTION_BANK = [')
    qb_end = html.find('\n];', qb_start)
    qb = html[qb_start:qb_end]

    passed = True

    # 1. NS-only terms (forbidden in options)
    ns_terms = [
        r'multiplicador\s+keynesiano',
        r'curva\s+phillips',
        r'\bIS-LM\b',
        r'propensión\s+marginal\s+a\s+consumir',
        r'teoría\s+cuantitativa\s+del\s+dinero',
    ]
    ns_issues = 0
    for term in ns_terms:
        matches = re.findall(term, qb, re.IGNORECASE)
        ns_issues += len(matches)
    if ns_issues > 0:
        print(f"❌ NS_terms: {ns_issues} violations")
        passed = False
    else:
        print(f"✅ NS_terms: Clean")

    # 2. AI symbols (specific mathematical/physics symbols only)
    ai_symbols = ['→', '↑', '↓', 'π', '∑', '≠', '≤', '≥', '∂', '∞']
    symbol_issues = 0
    for sym in ai_symbols:
        symbol_issues += qb.count(sym)
    if symbol_issues > 0:
        print(f"❌ AI_symbols: {symbol_issues} symbols found")
        passed = False
    else:
        print(f"✅ AI_symbols: Clean")

    # 3. Robotic phrases
    robotic = [
        'variable real relevante', 'concepto nm clave',
        'principio fundamental en nm', 'concepto clave en nm',
        'con enfoque en', 'a largo plazo, elevando'
    ]
    robotic_issues = 0
    for phrase in robotic:
        robotic_issues += len(re.findall(phrase, qb, re.IGNORECASE))
    if robotic_issues > 0:
        print(f"❌ robotic_phrases: {robotic_issues} found")
        passed = False
    else:
        print(f"✅ robotic_phrases: Clean")

    # 4. Parentheses in options — only flag explanatory ones
    # Allow: (IED), (LP), (CP), (DA), (OA), (ZLB), (PIB), abbreviations
    # Block: long explanatory phrases in parentheses within options
    opt_match = re.search(r'options:\[([^\]]+)\]', qb)
    paren_explanations = 0
    if opt_match:
        opts_str = opt_match.group(1)
        # Find parentheses in options
        parens = re.findall(r'\(([^)]+)\)', opts_str)
        for content in parens:
            stripped = content.strip()
            # Allowed abbreviations/technical terms
            allowed = ['IED', 'LP', 'CP', 'DA', 'OA', 'ZLB', 'PIB', 
                      'r = i', 'Fisher', 'Brecha', 'Brecha deflacionaria',
                      'Brecha inflacionaria', 'Pleno empleo', 'Tasa real']
            
            # Block if it's a long explanatory phrase
            if (len(stripped) > 8 and 
                not any(a in stripped for a in allowed) and
                ('concepto' in stripped.lower() or 
                 'variable' in stripped.lower() or
                 'relacionado' in stripped.lower() or
                 'según' in stripped.lower() or
                 'explicación' in stripped.lower())):
                paren_explanations += 1
            elif len(stripped.split()) >= 4 and not any(a in stripped for a in allowed):
                # Long phrases with 4+ words
                paren_explanations += 1

    if paren_explanations > 0:
        print(f"⚠️  Parenthetical_explanations: {paren_explanations} (review needed)")
        # Don't fail on this — just warn
    else:
        print(f"✅ Parenthetical_explanations: Clean")

    # 5. Score visibility
    has_white_text = re.search(r'\.score-value\{[^}]*color:#ffffff', html)
    has_brown_bg = re.search(r'\.score-inner\{[^}]*background:[^}]*#[4-7][da5a][0-9a-f]', html)
    if not (has_white_text and has_brown_bg):
        print(f"❌ score_visibility: Low contrast detected")
        passed = False
    else:
        print(f"✅ score_visibility: Visible on brown background")

    return passed

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "quiz_macroeconomia_ib_nm.html"
    result = validate(path)
    sys.exit(0 if result else 1)
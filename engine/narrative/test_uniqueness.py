import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from uniqueness import check_uniqueness, normalize_for_comparison, similarity_ratio

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def test_identical_text_scores_1():
    text = "Our methodology for this project draws on 15 years of SANRAL experience."
    check("identical text scores exactly 1.0", similarity_ratio(text, text) == 1.0)


def test_completely_different_text_scores_low():
    a = "Klipcorp Civils has completed 12 SANRAL road rehabilitation contracts since 2010."
    b = "Thabo Engineering specialises in municipal water reticulation for the eastern seaboard."
    score = similarity_ratio(a, b)
    check("unrelated company facts score well under the flag threshold", score < 0.6, score)


def test_case_and_punctuation_differences_dont_hide_real_similarity():
    a = "Our approach to this contract is based on strong site supervision and quality control."
    b = "OUR APPROACH TO THIS CONTRACT IS BASED ON STRONG SITE SUPERVISION, AND QUALITY-CONTROL!"
    score = similarity_ratio(a, b)
    check("case/punctuation-only differences still score high", score > 0.95, score)


def test_normalize_strips_punctuation_and_collapses_whitespace():
    result = normalize_for_comparison("Hello,   World!!")
    check("normalize lowercases, strips punctuation, collapses whitespace", result == "hello world", result)


def test_check_uniqueness_empty_other_texts_never_flags():
    score, flagged, idx = check_uniqueness("anything at all", [])
    check("no other texts -> score 0.0", score == 0.0)
    check("no other texts -> never flagged", flagged is False)
    check("no other texts -> no index", idx is None)


def test_check_uniqueness_flags_a_near_duplicate_against_one_of_several_others():
    new_text = "We propose a phased construction methodology with weekly site meetings and a dedicated quality plan."
    others = [
        "Completely unrelated text about water treatment plant commissioning procedures and chemical dosing.",
        "We propose a phased construction methodology, with weekly site meetings and a dedicated quality plan!",
        "A third company's own distinct approach to electrical reticulation design review.",
    ]
    score, flagged, idx = check_uniqueness(new_text, others, threshold=0.6)
    check("a near-duplicate among several others is flagged", flagged is True)
    check("the most similar one is correctly identified by index", idx == 1, idx)
    check("the score is genuinely high for a near-duplicate", score > 0.9, score)


def test_check_uniqueness_does_not_flag_genuinely_distinct_drafts():
    new_text = "Mahlangu Civils will deploy its own fleet of graders and a dedicated pavement-rehabilitation crew."
    others = [
        "Dlamini Consulting Engineers draws on its professional-services bench strength for design review.",
        "Nkosi Facilities proposes a three-branch rotating supervision model across all sites.",
    ]
    score, flagged, idx = check_uniqueness(new_text, others, threshold=0.6)
    check("genuinely distinct company-specific drafts are not flagged", flagged is False, score)


def test_threshold_is_respected_at_the_boundary():
    score, flagged, _ = check_uniqueness("abc", ["abd"], threshold=1.1)
    check("a threshold above any possible score never flags", flagged is False, score)


def main():
    test_identical_text_scores_1()
    test_completely_different_text_scores_low()
    test_case_and_punctuation_differences_dont_hide_real_similarity()
    test_normalize_strips_punctuation_and_collapses_whitespace()
    test_check_uniqueness_empty_other_texts_never_flags()
    test_check_uniqueness_flags_a_near_duplicate_against_one_of_several_others()
    test_check_uniqueness_does_not_flag_genuinely_distinct_drafts()
    test_threshold_is_respected_at_the_boundary()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()

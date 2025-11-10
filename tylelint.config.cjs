[1mdiff --git a/stylelint.config.cjs b/stylelint.config.cjs[m
[1mindex 560321ad..f899f5a3 100644[m
[1m--- a/stylelint.config.cjs[m
[1m+++ b/stylelint.config.cjs[m
[36m@@ -1,15 +1,16 @@[m
 module.exports = {[m
[31m-	extends: "stylelint-config-standard",[m
[31m-	rules: {[m
[31m-		indentation: "tab",[m
[31m-		"font-family-no-missing-generic-family-keyword": null,[m
[31m-		"no-descending-specificity": null,[m
[31m-		"at-rule-no-vendor-prefix": true,[m
[31m-		"media-feature-name-no-vendor-prefix": true,[m
[31m-		"property-no-vendor-prefix": true,[m
[31m-		"selector-no-vendor-prefix": true,[m
[31m-		"value-no-vendor-prefix": true,[m
[31m-		"selector-class-pattern": null,[m
[31m-		"selector-id-pattern": null,[m
[31m-	},[m
[32m+[m[32m    extends: "stylelint-config-standard",[m
[32m+[m[32m    rules: {[m
[32m+[m[32m        "font-family-no-missing-generic-family-keyword": null,[m
[32m+[m[32m        "no-descending-specificity": null,[m
[32m+[m[32m        "at-rule-no-vendor-prefix": true,[m
[32m+[m[32m        "media-feature-name-no-vendor-prefix": true,[m
[32m+[m[32m        "property-no-vendor-prefix": true,[m
[32m+[m[32m        "selector-no-vendor-prefix": true,[m
[32m+[m[32m        "value-no-vendor-prefix": true,[m
[32m+[m[32m        "selector-class-pattern": null,[m
[32m+[m[32m        "selector-id-pattern": null,[m
[32m+[m[32m        "no-duplicate-selectors": null,[m
[32m+[m[32m        "declaration-block-single-line-max-declarations": null,[m
[32m+[m[32m    },[m
 };[m

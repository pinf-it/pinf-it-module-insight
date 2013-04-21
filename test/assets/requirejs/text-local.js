// @see https://github.com/jrburke/requirejs/blob/master/tests/text/local.js
define(['text!./resources/local.html'], function (localHtml) {
    return {
        localHtml: localHtml
    }
});
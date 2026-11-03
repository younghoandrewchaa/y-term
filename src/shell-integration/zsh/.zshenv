# Restore the user's ZDOTDIR so zsh reads their own startup files from here on.
if [[ -n ${Y_TERM_USER_ZDOTDIR+set} ]]; then
  ZDOTDIR=$Y_TERM_USER_ZDOTDIR
  builtin unset Y_TERM_USER_ZDOTDIR
else
  builtin unset ZDOTDIR
fi
builtin typeset -g _yterm_dir=${${(%):-%x}:A:h}
[[ -r ${ZDOTDIR:-$HOME}/.zshenv ]] && builtin source -- ${ZDOTDIR:-$HOME}/.zshenv
if [[ -o interactive && -n $Y_TERM_SHELL_INTEGRATION_NONCE ]]; then
  builtin source -- $_yterm_dir/y-term-integration.zsh
fi
builtin unset _yterm_dir

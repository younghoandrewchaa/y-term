builtin typeset -g _yterm_nonce=$Y_TERM_SHELL_INTEGRATION_NONCE _yterm_ran=0 _yterm_status=0
builtin unset Y_TERM_SHELL_INTEGRATION_NONCE
builtin autoload -Uz add-zsh-hook

_yterm_escape() {
  builtin emulate -L zsh
  local LC_ALL=C out= c i
  for (( i = 1; i <= ${#1}; i++ )); do
    c=${1[i]}
    case $c in
      \\) out+='\\' ;;
      ';') out+='\x3b' ;;
      [[:cntrl:]]) builtin printf -v c '\\x%02x' "'$c"; out+=$c ;;
      *) out+=$c ;;
    esac
  done
  builtin print -rn -- $out
}
_yterm_save_status() { _yterm_status=$? }
_yterm_precmd() {
  (( _yterm_ran )) && builtin print -n "\e]133;D;$_yterm_status\a"
  _yterm_ran=0
  builtin print -n '\e]133;A\a'
  [[ $PS1 == *$'\e]133;B\a'* ]] || PS1+=$'%{\e]133;B\a%}'
}
_yterm_preexec() {
  builtin print -rn -- $'\e]633;E;'"$(_yterm_escape "$1")"";$_yterm_nonce"$'\a\e]133;C\a'
  _yterm_ran=1
}
# Install on the first prompt, after .zshrc, so the status capture runs first and the prompt marker runs last.
_yterm_install() {
  add-zsh-hook -d precmd _yterm_install
  precmd_functions=(_yterm_save_status ${precmd_functions:#_yterm_*} _yterm_precmd)
  add-zsh-hook preexec _yterm_preexec
  _yterm_precmd
}
add-zsh-hook precmd _yterm_install

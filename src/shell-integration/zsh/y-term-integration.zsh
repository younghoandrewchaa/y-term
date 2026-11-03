builtin typeset -g _yterm_ran=0 _yterm_status=0
builtin autoload -Uz add-zsh-hook

# Escapes $1 into $REPLY: \ as \\, ; as \x3b, control characters as \xhh.
_yterm_escape() {
  builtin emulate -L zsh -o extendedglob
  local LC_ALL=C out=${1//\\/\\\\}
  out=${out//;/\\x3b}
  out=${out//(#m)[[:cntrl:]]/\\x${(L)${(l:2::0:)$(( [##16] #MATCH ))}}}
  REPLY=$out
}
_yterm_save_status() { _yterm_status=$? }
_yterm_precmd() {
  (( _yterm_ran )) && builtin print -n "\e]133;D;$_yterm_status\a"
  _yterm_ran=0
  builtin print -n '\e]133;A\a'
  [[ $PS1 == *$'\e]133;B\a'* ]] || PS1+=$'%{\e]133;B\a%}'
}
_yterm_preexec() {
  _yterm_escape "$1"
  builtin print -rn -- $'\e]633;E;'"$REPLY;$_yterm_nonce"$'\a\e]133;C\a'
  _yterm_ran=1
}
# Install on the first prompt, after .zshrc, so the status capture runs first and the prompt marker runs last.
# zsh runs this cycle's hooks from a copy, so the first A and B are deferred with sched until they have all run.
_yterm_install() {
  add-zsh-hook -d precmd _yterm_install
  precmd_functions=(_yterm_save_status ${precmd_functions:#_yterm_*} _yterm_precmd)
  add-zsh-hook preexec _yterm_preexec
  if builtin zmodload zsh/sched 2>/dev/null; then
    builtin sched +0 _yterm_precmd
  else
    _yterm_precmd
  fi
}
add-zsh-hook precmd _yterm_install

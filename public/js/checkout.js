const onOrder = (btn) => {
  const csrf = btn.parentNode.querySelector('[name=_csrf]').value;
  fetch('/checkout', {
    method: 'POST',
    headers: {
      'csrf-token': csrf
    }
  })
    .then(res => res.json())
    .then(data => {
      if (data && data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    })
    .catch(err => console.log(err));

};